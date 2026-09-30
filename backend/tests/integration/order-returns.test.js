import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Customer order return requests (live MySQL):
 * POST /orders/:orderId/returns creates a REQUESTED ReturnRequest for
 * delivered/completed orders only (ownership + eligibility server-side);
 * GET returns the single current request. Creation persists the request,
 * its initial history row, and a customer notification atomically — never
 * touching Order.status, OrderStatusHistory, payments, or inventory.
 * Duplicate creation is guarded by UNIQUE(orderId): concurrent attempts
 * leave exactly one winner.
 */

const RUN = `TSTRT${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const DELIVERY_WALK = [
  "CONFIRMED",
  "PROCESSING",
  "DISPATCHED",
  "IN_TRANSIT",
  "ARRIVED_IN_CITY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
};

async function registerCustomer(tag) {
  const email = `${RUN.toLowerCase()}-${tag}@example.test`;
  const registered = await request(app).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    firstName: "Return",
    lastName: "Tester",
    phone: "9999999999",
  });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  const address = await request(app)
    .post("/api/v1/addresses")
    .set({ Authorization: `Bearer ${loggedIn.body.data.accessToken}` })
    .send({
      fullName: "Return Tester",
      phone: "9999999999",
      addressLine1: "1 Test Street",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
    });
  expect(address.status).toBe(201);
  return {
    email,
    token: loggedIn.body.data.accessToken,
    addressId: address.body.data.address.id,
  };
}

const headersFor = (customer) => ({ Authorization: `Bearer ${customer.token}` });

async function placeOrder(customer, quantity = 1) {
  const added = await request(app).post("/api/v1/cart/items").set(headersFor(customer)).send({
    variantId: ctx.variantId,
    quantity,
  });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(headersFor(customer)).send({
    shippingAddressId: customer.addressId,
  });
  expect(order.status).toBe(201);
  return order.body.data.order;
}

async function walkTo(customer, orderId, statuses) {
  for (const status of statuses) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app)
      .patch(`/api/v1/orders/admin/${orderId}/status`)
      .set(adminHeaders())
      .send({ status });
    expect(res.status).toBe(200);
  }
  const order = await request(app).get(`/api/v1/orders/${orderId}`).set(headersFor(customer));
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

  const inv = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 200 });
  expect(inv.status).toBe(201);
}, 90000);

afterAll(async () => {
  try {
    await request(app).patch(`/api/v1/products/${ctx.productId}`).set(adminHeaders()).send({ isActive: false });
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("return request creation", () => {
  it("persists an eligible return with ownership, reason, details, and REQUESTED status", async () => {
    const customer = await registerCustomer("alice");
    const order = await placeOrder(customer);
    await walkTo(customer, order.id, DELIVERY_WALK);

    const res = await request(app).post(`/api/v1/orders/${order.id}/returns`).set(headersFor(customer)).send({
      reason: "DAMAGED",
      details: "Box was crushed on arrival.",
    });
    expect(res.status).toBe(201);
    const body = res.body.data.returnRequest;
    expect(body).toMatchObject({
      orderId: order.id,
      status: "REQUESTED",
      reason: "DAMAGED",
      details: "Box was crushed on arrival.",
    });
    expect(body.id).toBeTruthy();
    expect(body.createdAt).toBeTruthy();

    const row = await prisma.returnRequest.findUnique({ where: { orderId: order.id } });
    expect(row.userId).toBe((await prisma.user.findUnique({ where: { email: customer.email } })).id);

    // Initial history row exists.
    const history = await prisma.returnRequestHistory.findMany({ where: { returnRequestId: body.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "REQUESTED", actorId: expect.any(String) });

    // Customer notification exists and links the order.
    const notes = await request(app).get("/api/v1/notifications").set(headersFor(customer));
    const note = notes.body.data.notifications.find((n) => n.orderId === order.id && n.title === "Return requested");
    expect(note).toBeTruthy();
    expect(note.message).toContain(order.orderNumber);

    // Order lifecycle untouched.
    const refreshed = await request(app).get(`/api/v1/orders/${order.id}`).set(headersFor(customer));
    expect(refreshed.body.data.order.status).toBe("DELIVERED");
    expect(refreshed.body.data.order.statusHistory.some((h) => h.status === "DELIVERED")).toBe(true);
    expect(refreshed.body.data.order.statusHistory).toHaveLength(order.statusHistory.length + DELIVERY_WALK.length);
  });

  it("accepts every supported reason", async () => {
    const reasons = [
      "WRONG_COLOR",
      "WRONG_SIZE",
      "DAMAGED",
      "DEFECTIVE",
      "WRONG_ITEM",
      "NOT_AS_DESCRIBED",
      "CHANGED_MIND",
      "OTHER",
    ];
    // One customer, one order per reason (returns are per-order). Shares a
    // single register+login pair to stay within the auth rate-limit budget.
    const customer = await registerCustomer("reasons");
    for (const reason of reasons) {
      // eslint-disable-next-line no-await-in-loop
      const order = await placeOrder(customer);
      // eslint-disable-next-line no-await-in-loop
      await walkTo(customer, order.id, DELIVERY_WALK);
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post(`/api/v1/orders/${order.id}/returns`)
        .set(headersFor(customer))
        .send(reason === "OTHER" ? { reason, details: "Does not match my needs." } : { reason });
      expect(res.status).toBe(201);
      expect(res.body.data.returnRequest.reason).toBe(reason);
    }
  }, 120000);

  it("rejects invalid reasons and OTHER/details violations", async () => {
    const customer = await registerCustomer("reasonrules");
    const order = await placeOrder(customer);
    await walkTo(customer, order.id, DELIVERY_WALK);
    const post = (body) =>
      request(app).post(`/api/v1/orders/${order.id}/returns`).set(headersFor(customer)).send(body);

    expect((await post({ reason: "TOO_EXPENSIVE" })).status).toBe(422);
    expect((await post({ reason: "OTHER" })).status).toBe(422);
    expect((await post({ reason: "OTHER", details: "   " })).status).toBe(422);
    expect((await post({ reason: "OTHER", details: "x".repeat(1001) })).status).toBe(422);
    expect((await post({})).status).toBe(422);

    const ok = await post({ reason: "OTHER", details: "  Arrived scratched.  " });
    expect(ok.status).toBe(201);
    expect(ok.body.data.returnRequest.details).toBe("Arrived scratched.");

    // None of the failures left rows behind: exactly the one success.
    expect(await prisma.returnRequest.count({ where: { orderId: order.id } })).toBe(1);
  });
});

describe("return eligibility", () => {
  it("rejects undelivered and cancelled orders, accepts completed ones", async () => {
    const customer = await registerCustomer("eligibility");

    const pending = await placeOrder(customer);
    const pendingRes = await request(app)
      .post(`/api/v1/orders/${pending.id}/returns`)
      .set(headersFor(customer))
      .send({ reason: "DAMAGED" });
    expect(pendingRes.status).toBe(422);
    expect(pendingRes.body.error.code).toBe("ORDER_RETURN_NOT_ELIGIBLE");

    const processing = await placeOrder(customer);
    await walkTo(customer, processing.id, ["CONFIRMED", "PROCESSING"]);
    const processingRes = await request(app)
      .post(`/api/v1/orders/${processing.id}/returns`)
      .set(headersFor(customer))
      .send({ reason: "DAMAGED" });
    expect(processingRes.status).toBe(422);

    const cancelled = await placeOrder(customer);
    await request(app).post(`/api/v1/orders/${cancelled.id}/cancel`).set(headersFor(customer)).expect(200);
    const cancelledRes = await request(app)
      .post(`/api/v1/orders/${cancelled.id}/returns`)
      .set(headersFor(customer))
      .send({ reason: "DAMAGED" });
    expect(cancelledRes.status).toBe(422);
    expect(cancelledRes.body.error.code).toBe("ORDER_RETURN_NOT_ELIGIBLE");

    const completed = await placeOrder(customer);
    await walkTo(customer, completed.id, [...DELIVERY_WALK, "COMPLETED"]);
    const completedRes = await request(app)
      .post(`/api/v1/orders/${completed.id}/returns`)
      .set(headersFor(customer))
      .send({ reason: "CHANGED_MIND" });
    expect(completedRes.status).toBe(201);
    expect(completedRes.body.data.returnRequest.status).toBe("REQUESTED");
  });

  it("rejects nonexistent and other customers' orders without distinction", async () => {
    const customer = await registerCustomer("ownership");
    const other = await registerCustomer("stranger");
    const order = await placeOrder(customer);
    await walkTo(customer, order.id, DELIVERY_WALK);

    const missing = await request(app)
      .post("/api/v1/orders/00000000-0000-0000-0000-000000000000/returns")
      .set(headersFor(customer))
      .send({ reason: "DAMAGED" });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("ORDER_NOT_FOUND");

    const foreign = await request(app)
      .post(`/api/v1/orders/${order.id}/returns`)
      .set(headersFor(other))
      .send({ reason: "DAMAGED" });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("ORDER_NOT_FOUND");

    const foreignGet = await request(app).get(`/api/v1/orders/${order.id}/returns`).set(headersFor(other));
    expect(foreignGet.status).toBe(404);
  });
});

describe("duplicate return protection", () => {
  it("rejects a second request for the same order", async () => {
    const customer = await registerCustomer("dupe");
    const order = await placeOrder(customer);
    await walkTo(customer, order.id, DELIVERY_WALK);

    const first = await request(app).post(`/api/v1/orders/${order.id}/returns`).set(headersFor(customer)).send({
      reason: "DEFECTIVE",
    });
    expect(first.status).toBe(201);

    const second = await request(app).post(`/api/v1/orders/${order.id}/returns`).set(headersFor(customer)).send({
      reason: "DAMAGED",
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("RETURN_ALREADY_REQUESTED");
    expect(second.body.error.message).toMatch(/already exists/i);

    expect(await prisma.returnRequest.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("leaves exactly one request under concurrent duplicate attempts", async () => {
    const customer = await registerCustomer("race");
    const order = await placeOrder(customer);
    await walkTo(customer, order.id, DELIVERY_WALK);

    const attempts = await Promise.all([
      request(app).post(`/api/v1/orders/${order.id}/returns`).set(headersFor(customer)).send({ reason: "DAMAGED" }),
      request(app).post(`/api/v1/orders/${order.id}/returns`).set(headersFor(customer)).send({ reason: "DEFECTIVE" }),
    ]);
    const succeeded = attempts.filter((r) => r.status === 201);
    const rejected = attempts.filter((r) => r.status !== 201);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].body.error.code).toBe("RETURN_ALREADY_REQUESTED");
    expect(await prisma.returnRequest.count({ where: { orderId: order.id } })).toBe(1);
  });
});

describe("return authorization and integrity", () => {
  it("rejects unauthenticated access", async () => {
    expect(await request(app).post("/api/v1/orders/00000000-0000-0000-0000-000000000000/returns").send({})).toHaveProperty(
      "status",
      401
    );
    expect(await request(app).get("/api/v1/orders/00000000-0000-0000-0000-000000000000/returns")).toHaveProperty(
      "status",
      401
    );
  });

  it("rejects spoofed userId fields and returns null when no request exists", async () => {
    const customer = await registerCustomer("spoof");
    const order = await placeOrder(customer);
    await walkTo(customer, order.id, DELIVERY_WALK);

    const empty = await request(app).get(`/api/v1/orders/${order.id}/returns`).set(headersFor(customer));
    expect(empty.status).toBe(200);
    expect(empty.body.data.returnRequest).toBeNull();

    // Strict schema: unknown authority fields never reach the service.
    const spoofed = await request(app).post(`/api/v1/orders/${order.id}/returns`).set(headersFor(customer)).send({
      reason: "DAMAGED",
      userId: "00000000-0000-0000-0000-000000000000",
    });
    expect(spoofed.status).toBe(422);
    expect(await prisma.returnRequest.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("creates no orphaned history or notifications on failure", async () => {
    const customer = await registerCustomer("integrity");
    const order = await placeOrder(customer);
    await walkTo(customer, order.id, DELIVERY_WALK);

    const notesBefore = await request(app).get("/api/v1/notifications").set(headersFor(customer));
    const historyBefore = await prisma.returnRequestHistory.count();

    const bad = await request(app).post(`/api/v1/orders/${order.id}/returns`).set(headersFor(customer)).send({
      reason: "OTHER",
    });
    expect(bad.status).toBe(422);

    expect(await prisma.returnRequest.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.returnRequestHistory.count()).toBe(historyBefore);
    const notesAfter = await request(app).get("/api/v1/notifications").set(headersFor(customer));
    expect(notesAfter.body.data.notifications).toHaveLength(notesBefore.body.data.notifications.length);
  });

  it("reads back the current request for the owning customer", async () => {
    const customer = await registerCustomer("readback");
    const order = await placeOrder(customer);
    await walkTo(customer, order.id, DELIVERY_WALK);

    const created = await request(app).post(`/api/v1/orders/${order.id}/returns`).set(headersFor(customer)).send({
      reason: "NOT_AS_DESCRIBED",
      details: "Color differs from photos.",
    });
    expect(created.status).toBe(201);

    const fetched = await request(app).get(`/api/v1/orders/${order.id}/returns`).set(headersFor(customer));
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.returnRequest).toMatchObject({
      orderId: order.id,
      status: "REQUESTED",
      reason: "NOT_AS_DESCRIBED",
      details: "Color differs from photos.",
    });
  });
});
