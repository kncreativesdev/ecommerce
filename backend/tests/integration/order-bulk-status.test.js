import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Bulk order status (atomic all-or-nothing) + geographic filtering.
 * - Admin city/state filters narrow the list via address snapshots.
 * - PATCH /orders/admin/bulk-status transitions many orders in ONE
 *   transaction (never a client loop): history + notification per order,
 *   exactly once, concurrency-safe.
 * - Invalid transitions fail the whole bulk with per-order failures and
 *   no partial writes.
 */

const RUN = `TSTBK${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
  customerToken: null,
  addressIdMumbai: null,
  addressIdDelhi: null,
  orderIds: [],
};

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });

async function placeOrder(addressId) {
  const added = await request(app).post("/api/v1/cart/items").set(customerHeaders()).send({
    variantId: ctx.variantId,
    quantity: 1,
  });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
    shippingAddressId: addressId,
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
    variants: [{ sku: `${RUN}-SKU`, name: "Standard", price: "50.00" }],
  });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  ctx.variantId = product.body.data.product.variants[0].id;

  const inv = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 20 });
  expect(inv.status).toBe(201);

  const email = `${RUN.toLowerCase()}@example.test`;
  const registered = await request(app).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    firstName: "Bulk",
    lastName: "Tester",
  });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  ctx.customerToken = loggedIn.body.data.accessToken;

  const mumbai = await request(app).post("/api/v1/addresses").set(customerHeaders()).send({
    fullName: "Bulk Tester",
    phone: "9999999999",
    addressLine1: "1 Sea Face",
    city: `${RUN}Mumbai`,
    state: `${RUN}Maharashtra`,
    postalCode: "400001",
    country: "India",
  });
  expect(mumbai.status).toBe(201);
  ctx.addressIdMumbai = mumbai.body.data.address.id;

  const delhi = await request(app).post("/api/v1/addresses").set(customerHeaders()).send({
    fullName: "Bulk Tester",
    phone: "9999999999",
    addressLine1: "1 Rajpath",
    city: `${RUN}Delhi`,
    state: `${RUN}DelhiState`,
    postalCode: "110001",
    country: "India",
  });
  expect(delhi.status).toBe(201);
  ctx.addressIdDelhi = delhi.body.data.address.id;

  const o1 = await placeOrder(ctx.addressIdMumbai);
  const o2 = await placeOrder(ctx.addressIdMumbai);
  const o3 = await placeOrder(ctx.addressIdDelhi);
  ctx.orderIds = [o1.id, o2.id, o3.id];
}, 90000);

afterAll(async () => {
  try {
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("admin geographic filtering", () => {
  it("filters by city and state via address snapshots", async () => {
    const byCity = await request(app)
      .get(`/api/v1/orders/admin?search=${RUN}&city=${RUN}Mumbai`)
      .set(adminHeaders());
    expect(byCity.status).toBe(200);
    expect(byCity.body.data.orders.length).toBeGreaterThanOrEqual(2);
    for (const order of byCity.body.data.orders) {
      const cities = (order.addresses || []).map((a) => a.city);
      expect(cities.some((c) => String(c).includes(`${RUN}Mumbai`))).toBe(true);
    }

    const byState = await request(app)
      .get(`/api/v1/orders/admin?search=${RUN}&state=${RUN}DelhiState`)
      .set(adminHeaders());
    expect(byState.status).toBe(200);
    expect(byState.body.data.orders.length).toBeGreaterThanOrEqual(1);
  });
});

describe("bulk status authorization", () => {
  it("rejects anonymous and customer-role access", async () => {
    const anonymous = await request(app)
      .patch("/api/v1/orders/admin/bulk-status")
      .send({ orderIds: ctx.orderIds.slice(0, 1), status: "CONFIRMED" });
    expect(anonymous.status).toBe(401);

    const customer = await request(app)
      .patch("/api/v1/orders/admin/bulk-status")
      .set(customerHeaders())
      .send({ orderIds: ctx.orderIds.slice(0, 1), status: "CONFIRMED" });
    expect(customer.status).toBe(403);
  });
});

describe("bulk status validation + atomicity", () => {
  it("transitions all selected orders with history + exactly-once notifications", async () => {
    const beforeCounts = await prisma.notification.count({
      where: { orderId: { in: ctx.orderIds.slice(0, 2) } },
    });
    const res = await request(app)
      .patch("/api/v1/orders/admin/bulk-status")
      .set(adminHeaders())
      .send({ orderIds: ctx.orderIds.slice(0, 2), status: "CONFIRMED" });
    expect(res.status).toBe(200);
    expect(res.body.data.orders).toHaveLength(2);
    for (const order of res.body.data.orders) {
      expect(order.status).toBe("CONFIRMED");
    }
    // History: exactly one CONFIRMED row per order, no duplicates.
    for (const id of ctx.orderIds.slice(0, 2)) {
      const rows = await prisma.orderStatusHistory.findMany({ where: { orderId: id, status: "CONFIRMED" } });
      expect(rows).toHaveLength(1);
      expect(rows[0].previousStatus).toBe("PENDING");
    }
    const afterCounts = await prisma.notification.count({
      where: { orderId: { in: ctx.orderIds.slice(0, 2) } },
    });
    expect(afterCounts).toBe(beforeCounts + 2);
  });

  it("rejects invalid transitions atomically with per-order failures and no writes", async () => {
    // o1/o2 are CONFIRMED (valid next: PROCESSING), o3 is PENDING (valid
    // next: CONFIRMED/CANCELLED). Requesting PROCESSING for all must fail
    // for o3 and apply to NONE (all-or-nothing).
    const res = await request(app)
      .patch("/api/v1/orders/admin/bulk-status")
      .set(adminHeaders())
      .send({ orderIds: ctx.orderIds, status: "PROCESSING" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORDER_BULK_VALIDATION_FAILED");
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(1);
    // No order moved: o1/o2 still CONFIRMED, o3 still PENDING.
    const o1 = await request(app).get(`/api/v1/orders/admin/${ctx.orderIds[0]}`).set(adminHeaders());
    const o3 = await request(app).get(`/api/v1/orders/admin/${ctx.orderIds[2]}`).set(adminHeaders());
    expect(o1.body.data.order.status).toBe("CONFIRMED");
    expect(o3.body.data.order.status).toBe("PENDING");
    // No duplicate history rows from the failed bulk.
    const o1Processing = await prisma.orderStatusHistory.findMany({
      where: { orderId: ctx.orderIds[0], status: "PROCESSING" },
    });
    expect(o1Processing).toHaveLength(0);
  });
});
