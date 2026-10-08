import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { companyOneAdminId, stampUserCompany } from "../helpers/userFixtures.js";

/**
 * Product lifecycle business rules (live MySQL):
 *
 * DEACTIVATION (`PATCH /products/:id { isActive: false }`)
 * - Allowed with no orders, only-cancelled orders, or only
 *   terminal (DELIVERED/COMPLETED) orders.
 * - Rejected with 409 PRODUCT_HAS_ACTIVE_ORDERS (product untouched,
 *   blocking order numbers in the error details) when any in-process
 *   order contains the product — one active order blocks even alongside
 *   cancelled/completed ones. Cancelling the blocking order unblocks.
 *
 * DELETION (`DELETE /products/:id`)
 * - Rejected with 409 PRODUCT_ACTIVE_CANNOT_DELETE while active
 *   (product untouched); confirmed idempotently once inactive.
 *
 * ORDER CANCELLATION / PAYMENT
 * - Cancellation moves the order AND its payment to CANCELLED in one
 *   transaction (no duplicate payment rows), so a cancelled order stops
 *   blocking deactivation.
 */

const RUN = `TSTPL${Date.now().toString(36).toUpperCase()}`;
const COMPANY_ONE_ADMIN_ID = await companyOneAdminId();
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: COMPANY_ONE_ADMIN_ID, roles: ["ADMIN"] })}` });

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

const ctx = {
  categoryId: null,
  customerToken: null,
  addressId: null,
  products: {}, // key -> { id, variantId }
  orders: {}, // key -> order record
};

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });

async function createProduct(key) {
  const product = await request(app).post("/api/v1/products").set(adminHeaders()).send({
    name: `${RUN} ${key}`,
    categoryId: ctx.categoryId,
    variants: [{ sku: `${RUN}-${key}`, name: "Standard", price: "100.00" }],
  });
  expect(product.status).toBe(201);
  const record = product.body.data.product;
  const inventory = await request(app)
    .post(`/api/v1/products/${record.id}/variants/${record.variants[0].id}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 50 });
  expect(inventory.status).toBe(201);
  ctx.products[key] = { id: record.id, variantId: record.variants[0].id };
}

async function placeOrder(key) {
  const added = await request(app)
    .post("/api/v1/cart/items")
    .set(customerHeaders())
    .send({ variantId: ctx.products[key].variantId, quantity: 1 });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
    shippingAddressId: ctx.addressId,
  });
  expect(order.status).toBe(201);
  ctx.orders[key] = order.body.data.order;
  return order.body.data.order;
}

async function adminAdvance(orderId, statuses) {
  for (const status of statuses) {
    const res = await request(app)
      .patch(`/api/v1/orders/admin/${orderId}/status`)
      .set(adminHeaders())
      .send({ status });
    expect(res.status).toBe(200);
  }
}

async function customerCancel(orderId) {
  const res = await request(app).post(`/api/v1/orders/${orderId}/cancel`).set(customerHeaders());
  expect(res.status).toBe(200);
  return res.body.data.order;
}

async function fetchProductAdmin(id) {
  const res = await request(app).get(`/api/v1/products/${id}?status=all`).set(adminHeaders());
  expect(res.status).toBe(200);
  return res.body.data.product;
}

beforeAll(async () => {
  const category = await request(app).post("/api/v1/categories").set(adminHeaders()).send({
    name: `${RUN} Category`,
  });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  for (const key of ["A", "B", "C", "D", "E"]) {
    await createProduct(key);
  }

  const email = `${RUN.toLowerCase()}@example.test`;
  const registered = await request(app)
    .post("/api/v1/auth/register")
    .send({ email, password: "TestPass123!", firstName: "Lifecycle", lastName: "Tester", phone: "9999999999" });
  expect(registered.status).toBe(201);
  await stampUserCompany(registered.body.data.user.id);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  ctx.customerToken = loggedIn.body.data.accessToken;

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
}, 90000);

afterAll(async () => {
  // Best-effort lifecycle cleanup: deactivate (where the rules allow it)
  // then confirm deletion. Anything still blocked stays as an ordinary
  // uniquely-named row, per the suite convention.
  for (const key of ["A", "B", "C", "D", "E"]) {
    const id = ctx.products[key]?.id;
    if (!id) continue;
    try {
      await request(app).patch(`/api/v1/products/${id}`).set(adminHeaders()).send({ isActive: false });
    } catch { /* best-effort */ }
    try {
      await request(app).delete(`/api/v1/products/${id}`).set(adminHeaders());
    } catch { /* best-effort */ }
  }
  try {
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("product deactivation eligibility", () => {
  it("deactivates an active product with no orders", async () => {
    const res = await request(app)
      .patch(`/api/v1/products/${ctx.products.A.id}`)
      .set(adminHeaders())
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.product.isActive).toBe(false);
  });

  it("deactivates a product appearing only in cancelled orders", async () => {
    const order = await placeOrder("B");
    const cancelled = await customerCancel(order.id);
    expect(cancelled.status).toBe("CANCELLED");
    // The cancelled order's payment moved with it, transactionally.
    expect(cancelled.payments).toHaveLength(1);
    expect(cancelled.payments[0].status).toBe("CANCELLED");

    const res = await request(app)
      .patch(`/api/v1/products/${ctx.products.B.id}`)
      .set(adminHeaders())
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.product.isActive).toBe(false);
  });

  it("deactivates a product appearing only in terminal completed orders", async () => {
    const order = await placeOrder("C");
    await adminAdvance(order.id, FULL_CHAIN);

    const res = await request(app)
      .patch(`/api/v1/products/${ctx.products.C.id}`)
      .set(adminHeaders())
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.product.isActive).toBe(false);
  });

  it("rejects deactivation while an in-process order contains the product", async () => {
    const order = await placeOrder("D");
    expect(order.status).toBe("PENDING");

    const res = await request(app)
      .patch(`/api/v1/products/${ctx.products.D.id}`)
      .set(adminHeaders())
      .send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRODUCT_HAS_ACTIVE_ORDERS");
    expect(res.body.error.message).toContain(order.orderNumber);
    expect(res.body.error.details.blockingOrderCount).toBe(1);
    expect(res.body.error.details.blockingOrders[0]).toMatchObject({
      orderNumber: order.orderNumber,
      status: "PENDING",
    });

    // The rejection modified nothing: the product is still active.
    const product = await fetchProductAdmin(ctx.products.D.id);
    expect(product.isActive).toBe(true);
  });

  it("stays blocked by one in-process order among cancelled and completed ones", async () => {
    const cancelledOrder = await placeOrder("E");
    await customerCancel(cancelledOrder.id);
    const completedOrder = await placeOrder("E");
    await adminAdvance(completedOrder.id, FULL_CHAIN);
    const pendingOrder = await placeOrder("E");

    const res = await request(app)
      .patch(`/api/v1/products/${ctx.products.E.id}`)
      .set(adminHeaders())
      .send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRODUCT_HAS_ACTIVE_ORDERS");
    expect(res.body.error.details.blockingOrderCount).toBe(1);
    expect(res.body.error.details.blockingOrders[0].orderNumber).toBe(pendingOrder.orderNumber);

    ctx.orders.Epending = pendingOrder;
  });

  it("becomes eligible once the blocking order is cancelled", async () => {
    const cancelled = await customerCancel(ctx.orders.Epending.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.payments[0].status).toBe("CANCELLED");

    const res = await request(app)
      .patch(`/api/v1/products/${ctx.products.E.id}`)
      .set(adminHeaders())
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.product.isActive).toBe(false);
  });
});

describe("product deletion lifecycle", () => {
  it("rejects deletion of an active product without modifying it", async () => {
    const res = await request(app).delete(`/api/v1/products/${ctx.products.D.id}`).set(adminHeaders());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRODUCT_ACTIVE_CANNOT_DELETE");

    const product = await fetchProductAdmin(ctx.products.D.id);
    expect(product.isActive).toBe(true);
  });

  it("deletes an inactive product per the existing deletion semantics", async () => {
    const res = await request(app).delete(`/api/v1/products/${ctx.products.A.id}`).set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.product.isActive).toBe(false);
  });

  it("leaves cancelled-order history intact after deactivation", async () => {
    // Product B was deactivated above; its cancelled order must still read
    // fully (snapshots, payment, history) — deactivation never rewrites it.
    const order = await request(app).get(`/api/v1/orders/${ctx.orders.B.id}`).set(customerHeaders());
    expect(order.status).toBe(200);
    expect(order.body.data.order.status).toBe("CANCELLED");
    expect(order.body.data.order.items).toHaveLength(1);
    expect(order.body.data.order.payments[0].status).toBe("CANCELLED");
    expect(order.body.data.order.statusHistory.length).toBeGreaterThanOrEqual(2);
  });
});
