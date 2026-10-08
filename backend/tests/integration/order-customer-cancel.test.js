import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { companyOneAdminId, stampUserCompany } from "../helpers/userFixtures.js";

/**
 * Customer order self-cancellation (POST /orders/:id/cancel):
 * - Eligible orders (PENDING/CONFIRMED/PROCESSING) cancel with history +
 *   notification + inventory restore (same transaction as admin cancel).
 * - Cancellation moves the order's payment to CANCELLED in the same
 *   transaction (single row, amount untouched, terminal afterwards).
 * - Non-cancellable states (post-dispatch, DELIVERED, COMPLETED,
 *   CANCELLED) are rejected with 409 and never mutate.
 * - Ownership is enforced: other users' orders are 404, never
 *   distinguished from missing.
 */

const RUN = `TSTCC${Date.now().toString(36).toUpperCase()}`;
const COMPANY_ONE_ADMIN_ID = await companyOneAdminId();
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: COMPANY_ONE_ADMIN_ID, roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
  addressId: null,
  customerToken: null,
  otherToken: null,
};

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });
const otherHeaders = () => ({ Authorization: `Bearer ${ctx.otherToken}` });

async function registerCustomer(firstName) {
  const email = `${RUN.toLowerCase()}-${firstName.toLowerCase()}@example.test`;
  const registered = await request(app)
    .post("/api/v1/auth/register")
    .send({ email, password: "TestPass123!", firstName, lastName: "Tester", phone: "9999999999" });
  expect(registered.status).toBe(201);
  await stampUserCompany(registered.body.data.user.id);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  return loggedIn.body.data.accessToken;
}

async function placeOrder() {
  const added = await request(app)
    .post("/api/v1/cart/items")
    .set(customerHeaders())
    .send({ variantId: ctx.variantId, quantity: 1 });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
    shippingAddressId: ctx.addressId,
  });
  expect(order.status).toBe(201);
  return order.body.data.order;
}

beforeAll(async () => {
  const category = await request(app).post("/api/v1/categories").set(adminHeaders()).send({
    name: `${RUN} Category`,
  });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app).post("/api/v1/products").set(adminHeaders()).send({
    name: `${RUN} Widget`,
    categoryId: ctx.categoryId,
    variants: [{ sku: `${RUN}-SKU`, name: "Standard", price: "100.00" }],
  });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  ctx.variantId = product.body.data.product.variants[0].id;

  const inventory = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 50 });
  expect(inventory.status).toBe(201);

  ctx.customerToken = await registerCustomer("Canceller");
  ctx.otherToken = await registerCustomer("Other");

  const address = await request(app).post("/api/v1/addresses").set(customerHeaders()).send({
    fullName: "Canceller Tester",
    phone: "9999999999",
    addressLine1: "1 Test Street",
    city: "Ludhiana",
    state: "Punjab",
    postalCode: "141001",
    country: "India",
  });
  expect(address.status).toBe(201);
  ctx.addressId = address.body.data.address.id;
}, 90000);

afterAll(async () => {
  // Product lifecycle cleanup (deactivate first, then delete — both
  // best-effort; leftover in-process orders may keep it active).
  try {
    await request(app).patch(`/api/v1/products/${ctx.productId}`).set(adminHeaders()).send({ isActive: false });
  } catch { /* best-effort */ }
  try {
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  try {
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("customer order cancellation", () => {
  it("cancels a PENDING order with history, notification, stock restore, and payment cancellation", async () => {
    const before = await request(app)
      .get(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
      .set(adminHeaders());
    const qtyBefore = before.body.data.inventory.quantity;

    const order = await placeOrder();
    expect(order.status).toBe("PENDING");
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0].status).toBe("PENDING");

    const res = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(customerHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe("CANCELLED");
    expect(res.body.data.order.statusHistory).toHaveLength(2);
    const latest = res.body.data.order.statusHistory[1];
    expect(latest).toMatchObject({ status: "CANCELLED", previousStatus: "PENDING" });

    // Payment moved with the order in the same transaction: exactly one
    // row (no duplicate created), now CANCELLED, amount untouched (no
    // refund recorded).
    expect(res.body.data.order.payments).toHaveLength(1);
    expect(res.body.data.order.payments[0].status).toBe("CANCELLED");
    expect(res.body.data.order.payments[0].amount).toBe(order.payments[0].amount);

    // Totals and snapshots are untouched by cancellation.
    expect(res.body.data.order.grandTotal).toBe(order.grandTotal);

    const after = await request(app)
      .get(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
      .set(adminHeaders());
    expect(after.body.data.inventory.quantity).toBe(qtyBefore);

    const ledger = await prisma.inventoryTransaction.findMany({
      where: { variantId: ctx.variantId, referenceId: order.id },
    });
    expect(ledger.some((t) => t.type === "ORDER_CANCELLED")).toBe(true);

    const unread = await request(app).get("/api/v1/notifications/unread-count").set(customerHeaders());
    expect(unread.status).toBe(200);
    expect(unread.body.data.unreadCount).toBeGreaterThanOrEqual(1);

    // The cancelled payment is terminal: the standalone payment endpoint
    // can neither move it nor record a refund over it.
    const paymentWrite = await request(app)
      .patch(`/api/v1/orders/admin/${order.id}/payment`)
      .set(adminHeaders())
      .send({ status: "REFUNDED" });
    expect(paymentWrite.status).toBe(409);
    expect(paymentWrite.body.error.code).toBe("PAYMENT_INVALID_STATUS_TRANSITION");
  });

  it("cancels a CONFIRMED order", async () => {
    const order = await placeOrder();
    const advanced = await request(app)
      .patch(`/api/v1/orders/admin/${order.id}/status`)
      .set(adminHeaders())
      .send({ status: "CONFIRMED" });
    expect(advanced.status).toBe(200);

    const res = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(customerHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe("CANCELLED");
  });

  it("rejects cancellation once the order has left the store", async () => {
    const order = await placeOrder();
    await request(app).patch(`/api/v1/orders/admin/${order.id}/status`).set(adminHeaders()).send({ status: "CONFIRMED" });
    await request(app).patch(`/api/v1/orders/admin/${order.id}/status`).set(adminHeaders()).send({ status: "PROCESSING" });
    await request(app).patch(`/api/v1/orders/admin/${order.id}/status`).set(adminHeaders()).send({ status: "DISPATCHED" });

    const res = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(customerHeaders());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORDER_INVALID_STATUS_TRANSITION");

    // Rejected cancellation writes no history row.
    const detail = await request(app).get(`/api/v1/orders/${order.id}`).set(customerHeaders());
    expect(detail.body.data.order.status).toBe("DISPATCHED");
    expect(detail.body.data.order.statusHistory).toHaveLength(4);
  });

  it("rejects repeat cancellation of an already-cancelled order", async () => {
    const order = await placeOrder();
    const first = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(customerHeaders());
    expect(first.status).toBe(200);

    const repeat = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(customerHeaders());
    expect(repeat.status).toBe(409);
    expect(["ORDER_STATUS_UNCHANGED", "ORDER_INVALID_STATUS_TRANSITION"]).toContain(repeat.body.error.code);
  });

  it("returns 404 for another user's order (never distinguished)", async () => {
    const order = await placeOrder();
    const cross = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(otherHeaders());
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe("ORDER_NOT_FOUND");

    const missing = await request(app)
      .post("/api/v1/orders/00000000-0000-0000-0000-000000000000/cancel")
      .set(customerHeaders());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("requires authentication and validates the id", async () => {
    const anonymous = await request(app).post("/api/v1/orders/00000000-0000-0000-0000-000000000000/cancel");
    expect(anonymous.status).toBe(401);

    const invalid = await request(app).post("/api/v1/orders/not-a-uuid/cancel").set(customerHeaders());
    expect(invalid.status).toBe(422);
  });
});
