import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * End-to-end order lifecycle against live MySQL (supertest):
 * category → product+variant → inventory → customer → address → cart →
 * order → full PENDING…COMPLETED walk with history + notification
 * assertions at every step, plus negative paths (backward moves,
 * same-status retries, post-dispatch cancellation), cancellation stock
 * restore, marketing/announcement CRUD + visibility, and auth guards.
 *
 * Test data uses a unique TSTLC prefix. Catalog rows are deactivated
 * afterwards; marketing/announcement rows are removed via prisma.
 * Placed orders and their transactional notifications intentionally
 * persist — orders are immutable by design.
 */

const RUN = `TSTLC${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  customerToken: null,
  customerId: null,
  addressId: null,
  variantId: null,
  productId: null,
  categoryId: null,
  orderId: null,
  orderNumber: null,
  marketingId: null,
  announcementId: null,
};

const FULL_CHAIN = [
  "CONFIRMED",
  "PROCESSING",
  "DISPATCHED",
  "IN_TRANSIT",
  "ARRIVED_IN_CITY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "COMPLETED",
];

async function registerCustomer() {
  const email = `${RUN.toLowerCase()}@example.test`;
  const registered = await request(app)
    .post("/api/v1/auth/register")
    .send({ email, password: "TestPass123!", firstName: "Lifecycle", lastName: "Tester" });
  expect(registered.status).toBe(201);
  ctx.customerId = registered.body.data.user.id;
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  ctx.customerToken = loggedIn.body.data.accessToken;
}

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });

async function placeOrder() {
  const added = await request(app)
    .post("/api/v1/cart/items")
    .set(customerHeaders())
    .send({ variantId: ctx.variantId, quantity: 2 });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
    shippingAddressId: ctx.addressId,
  });
  expect(order.status).toBe(201);
  return order.body.data.order;
}

async function adminPatchStatus(orderId, body) {
  return request(app).patch(`/api/v1/orders/admin/${orderId}/status`).set(adminHeaders()).send(body);
}

beforeAll(async () => {
  const category = await request(app)
    .post("/api/v1/categories")
    .set(adminHeaders())
    .send({ name: `${RUN} Category` });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app)
    .post("/api/v1/products")
    .set(adminHeaders())
    .send({
      name: `${RUN} Widget`,
      categoryId: ctx.categoryId,
      variants: [{ sku: `${RUN}-SKU1`, name: "Standard", price: "100.00" }],
    });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  ctx.variantId = product.body.data.product.variants[0].id;

  const inventory = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 50 });
  expect(inventory.status).toBe(201);

  await registerCustomer();

  const address = await request(app).post("/api/v1/addresses").set(customerHeaders()).send({
    fullName: "Lifecycle Tester",
    phone: "9999999999",
    addressLine1: "1 Test Street",
    city: "Ludhiana",
    state: "Punjab",
    postalCode: "141001",
    country: "India",
  });
  expect(address.status).toBe(201);
  ctx.addressId = address.body.data.address.id;
}, 60000);

afterAll(async () => {
  try {
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  try {
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  try {
    await prisma.marketingNotification.deleteMany({ where: { title: { startsWith: RUN } } });
  } catch { /* best-effort */ }
  try {
    await prisma.siteAnnouncement.deleteMany({ where: { message: { startsWith: RUN } } });
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("order creation seeds the lifecycle ledger", () => {
  it("creates a PENDING order with one PENDING history row and no notification", async () => {
    const order = await placeOrder();
    ctx.orderId = order.id;
    ctx.orderNumber = order.orderNumber;
    expect(order.status).toBe("PENDING");
    expect(order.statusHistory).toHaveLength(1);
    expect(order.statusHistory[0]).toMatchObject({ status: "PENDING", previousStatus: null });

    const unread = await request(app).get("/api/v1/notifications/unread-count").set(customerHeaders());
    expect(unread.status).toBe(200);
    expect(unread.body.data.unreadCount).toBe(0);
  });
});

describe("full fulfilment walk PENDING → COMPLETED", () => {
  it("advances through every state with history + notification per step", async () => {
    let expectedHistory = 1;
    for (const status of FULL_CHAIN) {
      const body = status === "IN_TRANSIT" ? { status, note: "Handed to courier" } : { status };
      const res = await adminPatchStatus(ctx.orderId, body);
      expect(res.status).toBe(200);
      const order = res.body.data.order;
      expect(order.status).toBe(status);
      expectedHistory += 1;
      expect(order.statusHistory).toHaveLength(expectedHistory);
      const latest = order.statusHistory[order.statusHistory.length - 1];
      expect(latest.status).toBe(status);
      if (status === "IN_TRANSIT") {
        expect(latest.note).toBe("Handed to courier");
      }
      // Totals never move with status changes.
      expect(order.grandTotal).toBe("200.00");
      expect(order.subtotal).toBe("200.00");
    }

    const unread = await request(app).get("/api/v1/notifications/unread-count").set(customerHeaders());
    expect(unread.status).toBe(200);
    expect(unread.body.data.unreadCount).toBe(FULL_CHAIN.length);

    const list = await request(app).get("/api/v1/notifications").set(customerHeaders());
    expect(list.status).toBe(200);
    expect(list.body.data.notifications).toHaveLength(FULL_CHAIN.length);
    expect(list.body.meta.unreadCount).toBe(FULL_CHAIN.length);
    // Newest first; completion copy is server-generated.
    expect(list.body.data.notifications[0]).toMatchObject({
      type: "ORDER_STATUS",
      title: "Order completed",
      orderId: ctx.orderId,
      isRead: false,
    });
    expect(list.body.data.notifications[0].message).toContain(ctx.orderNumber);
  });

  it("marks notifications read with an authoritative unread count", async () => {
    const list = await request(app).get("/api/v1/notifications").set(customerHeaders());
    const firstId = list.body.data.notifications[0].id;

    const read = await request(app).patch(`/api/v1/notifications/${firstId}/read`).set(customerHeaders());
    expect(read.status).toBe(200);
    expect(read.body.data.notification.isRead).toBe(true);
    expect(read.body.meta.unreadCount).toBe(FULL_CHAIN.length - 1);

    const all = await request(app).post("/api/v1/notifications/read-all").set(customerHeaders());
    expect(all.status).toBe(200);
    expect(all.body.meta.unreadCount).toBe(0);

    const unread = await request(app).get("/api/v1/notifications/unread-count").set(customerHeaders());
    expect(unread.body.data.unreadCount).toBe(0);
  });

  it("keeps the customer order detail timeline intact", async () => {
    const res = await request(app).get(`/api/v1/orders/${ctx.orderId}`).set(customerHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe("COMPLETED");
    expect(res.body.data.order.statusHistory).toHaveLength(FULL_CHAIN.length + 1);
  });
});

describe("transition guards", () => {
  it("rejects backward moves, same-status retries, and terminal mutations", async () => {
    const backward = await adminPatchStatus(ctx.orderId, { status: "DELIVERED" });
    expect(backward.status).toBe(409);
    expect(backward.body.error.code).toBe("ORDER_INVALID_STATUS_TRANSITION");

    const same = await adminPatchStatus(ctx.orderId, { status: "COMPLETED" });
    expect(same.status).toBe(409);
    expect(same.body.error.code).toBe("ORDER_STATUS_UNCHANGED");

    // No duplicate history/notification rows from the rejected retries.
    const detail = await request(app).get(`/api/v1/orders/admin/${ctx.orderId}`).set(adminHeaders());
    expect(detail.body.data.order.statusHistory).toHaveLength(FULL_CHAIN.length + 1);
  });

  it("rejects cancellation once the order has left the store", async () => {
    const order = await placeOrder();
    await adminPatchStatus(order.id, { status: "CONFIRMED" });
    await adminPatchStatus(order.id, { status: "PROCESSING" });
    await adminPatchStatus(order.id, { status: "DISPATCHED" });
    const cancelled = await adminPatchStatus(order.id, { status: "CANCELLED" });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error.code).toBe("ORDER_INVALID_STATUS_TRANSITION");
  });

  it("restores stock on pre-dispatch cancellation with history + notification", async () => {
    const before = await request(app)
      .get(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
      .set(adminHeaders());
    const qtyBefore = before.body.data.inventory.quantity;

    const order = await placeOrder();
    const cancelled = await adminPatchStatus(order.id, { status: "CANCELLED" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.order.status).toBe("CANCELLED");
    expect(cancelled.body.data.order.statusHistory).toHaveLength(2);

    const after = await request(app)
      .get(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
      .set(adminHeaders());
    expect(after.body.data.inventory.quantity).toBe(qtyBefore);

    const ledger = await prisma.inventoryTransaction.findMany({
      where: { variantId: ctx.variantId, referenceId: order.id },
    });
    expect(ledger.some((t) => t.type === "ORDER_CANCELLED")).toBe(true);
  });

  it("forbids customer status writes and cross-user notification reads", async () => {
    const customerWrite = await request(app)
      .patch(`/api/v1/orders/admin/${ctx.orderId}/status`)
      .set(customerHeaders())
      .send({ status: "PENDING" });
    expect(customerWrite.status).toBe(403);

    const otherEmail = `${RUN.toLowerCase()}-other@example.test`;
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: otherEmail, password: "TestPass123!" });
    const otherLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: otherEmail, password: "TestPass123!" });
    const otherHeaders = { Authorization: `Bearer ${otherLogin.body.data.accessToken}` };

    const list = await request(app).get("/api/v1/notifications").set(otherHeaders);
    expect(list.status).toBe(200);
    expect(list.body.data.notifications).toHaveLength(0);

    const mine = await request(app).get("/api/v1/notifications").set(customerHeaders());
    const myId = mine.body.data.notifications[0]?.id;
    if (myId) {
      const cross = await request(app).patch(`/api/v1/notifications/${myId}/read`).set(otherHeaders);
      expect(cross.status).toBe(404);
    }
  });
});

describe("marketing notifications (admin-managed broadcasts)", () => {
  it("creates, edits, schedules, and exposes only active broadcasts", async () => {
    const created = await request(app)
      .post("/api/v1/marketing/notifications/admin")
      .set(adminHeaders())
      .send({
        title: `${RUN} Festive Offer`,
        message: "Up to 40% off audio gear",
        type: "OFFER",
        linkType: "SHOP",
      });
    // linkValue is required alongside linkType.
    expect(created.status).toBe(422);
    const ok = await request(app)
      .post("/api/v1/marketing/notifications/admin")
      .set(adminHeaders())
      .send({
        title: `${RUN} Festive Offer`,
        message: "Up to 40% off audio gear",
        type: "OFFER",
        linkType: "SHOP",
        linkValue: "/shop",
      });
    expect(ok.status).toBe(201);
    ctx.marketingId = ok.body.data.notification.id;

    const customerSees = await request(app).get("/api/v1/marketing/notifications/active").set(customerHeaders());
    expect(customerSees.status).toBe(200);
    expect(customerSees.body.data.notifications.some((n) => n.id === ctx.marketingId)).toBe(true);

    const deactivated = await request(app)
      .patch(`/api/v1/marketing/notifications/admin/${ctx.marketingId}`)
      .set(adminHeaders())
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);

    const hidden = await request(app).get("/api/v1/marketing/notifications/active").set(customerHeaders());
    expect(hidden.body.data.notifications.some((n) => n.id === ctx.marketingId)).toBe(false);

    const customerWrite = await request(app)
      .post("/api/v1/marketing/notifications/admin")
      .set(customerHeaders())
      .send({ title: "x", message: "y" });
    expect(customerWrite.status).toBe(403);

    const removed = await request(app)
      .delete(`/api/v1/marketing/notifications/admin/${ctx.marketingId}`)
      .set(adminHeaders());
    expect(removed.status).toBe(200);
    ctx.marketingId = null;
  });
});

describe("site announcements (admin-editable top bar)", () => {
  it("publishes one deterministic current announcement and hides the expired", async () => {
    // Baseline: whatever is currently live GLOBALLY (possibly a pre-existing
    // active announcement from preserved database data, or null). Captured
    // so expiry asserts a revert without assuming a globally empty bar —
    // no other test file writes announcements, so the revert is deterministic.
    const baseline = await request(app).get("/api/v1/announcements/current");
    expect(baseline.status).toBe(200);

    const created = await request(app)
      .post("/api/v1/announcements/admin")
      .set(adminHeaders())
      .send({
        message: `${RUN} Festive Sale — up to 40% off`,
        linkLabel: "Shop now",
        linkTarget: "/shop",
        // Highest priority wins `current` (priority desc, newest first)
        // regardless of any other active announcements in the shared DB.
        priority: 1000,
      });
    expect(created.status).toBe(201);
    ctx.announcementId = created.body.data.announcement.id;

    const current = await request(app).get("/api/v1/announcements/current");
    expect(current.status).toBe(200);
    expect(current.body.data.announcement.message).toBe(`${RUN} Festive Sale — up to 40% off`);
    // Public shape exposes no admin metadata.
    expect(current.body.data.announcement).not.toHaveProperty("isActive");

    await request(app)
      .patch(`/api/v1/announcements/admin/${ctx.announcementId}`)
      .set(adminHeaders())
      .send({ expiresAt: new Date(Date.now() - 1000).toISOString() });

    // Expiry hides it: the bar reverts to the pre-test baseline (null on a
    // clean database) and never shows the expired message.
    const gone = await request(app).get("/api/v1/announcements/current");
    expect(gone.status).toBe(200);
    expect(gone.body.data.announcement).toEqual(baseline.body.data.announcement);
    expect(gone.body.data.announcement?.message ?? null).not.toBe(
      `${RUN} Festive Sale — up to 40% off`
    );

    const customerWrite = await request(app)
      .post("/api/v1/announcements/admin")
      .set(customerHeaders())
      .send({ message: "hijack" });
    expect(customerWrite.status).toBe(403);

    const external = await request(app)
      .post("/api/v1/announcements/admin")
      .set(adminHeaders())
      .send({ message: `${RUN} evil`, linkTarget: "https://evil.example" });
    expect(external.status).toBe(422);

    // Explicit per-test cleanup keeps the high-priority row's active window
    // minimal; the afterAll RUN-prefix sweep remains as a backstop.
    const removed = await request(app)
      .delete(`/api/v1/announcements/admin/${ctx.announcementId}`)
      .set(adminHeaders());
    expect(removed.status).toBe(200);
    ctx.announcementId = null;
  });
});
