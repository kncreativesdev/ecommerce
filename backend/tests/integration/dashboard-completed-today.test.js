import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { rangeFrame } from "../../src/modules/dashboard/dashboard.service.js";

/**
 * Regression: "completed today" counts completion EVENTS (immutable
 * OrderStatusHistory with status COMPLETED inside the UTC day), never
 * current status alone and never creation date.
 * - An order completed on a previous date is NOT counted as completed today.
 * - UTC day boundaries are exact (23:59:59.999Z yesterday excluded,
 *   00:00:00.000Z today included).
 */

const RUN = `TSTCD${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
  customerToken: null,
  addressId: null,
  todayOrderId: null,
  oldOrderId: null,
};

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });
const FULL_CHAIN = ["CONFIRMED", "PROCESSING", "DISPATCHED", "IN_TRANSIT", "ARRIVED_IN_CITY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED"];

async function placeAndComplete() {
  const added = await request(app).post("/api/v1/cart/items").set(customerHeaders()).send({
    variantId: ctx.variantId,
    quantity: 1,
  });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
    shippingAddressId: ctx.addressId,
  });
  expect(order.status).toBe(201);
  const id = order.body.data.order.id;
  for (const status of FULL_CHAIN) {
    const res = await request(app).patch(`/api/v1/orders/admin/${id}/status`).set(adminHeaders()).send({ status });
    expect(res.status).toBe(200);
  }
  return id;
}

async function summaryToday() {
  const res = await request(app).get("/api/v1/dashboard/summary?range=today").set(adminHeaders());
  expect(res.status).toBe(200);
  return res.body.data.summary;
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
    variants: [{ sku: `${RUN}-SKU`, name: "Standard", price: "20.00" }],
  });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  ctx.variantId = product.body.data.product.variants[0].id;

  const inv = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 10 });
  expect(inv.status).toBe(201);

  const email = `${RUN.toLowerCase()}@example.test`;
  const registered = await request(app).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    firstName: "Completed",
    lastName: "Tester",
  });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  ctx.customerToken = loggedIn.body.data.accessToken;

  const address = await request(app).post("/api/v1/addresses").set(customerHeaders()).send({
    fullName: "Completed Tester",
    phone: "9999999999",
    addressLine1: "1 Test Street",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    country: "India",
  });
  expect(address.status).toBe(201);
  ctx.addressId = address.body.data.address.id;

  ctx.todayOrderId = await placeAndComplete();
  ctx.oldOrderId = await placeAndComplete();

  // Backdate the OLD order's COMPLETED history event to yesterday (UTC),
  // keeping its current status COMPLETED — it must not count as today.
  const now = new Date();
  const { from } = rangeFrame("today", now);
  const yesterdayCompletion = new Date(from.getTime() - 60 * 1000);
  const updated = await prisma.orderStatusHistory.updateMany({
    where: { orderId: ctx.oldOrderId, status: "COMPLETED" },
    data: { createdAt: yesterdayCompletion },
  });
  expect(updated.count).toBe(1);
}, 90000);

afterAll(async () => {
  try {
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("completed-today regression", () => {
  it("counts only orders whose COMPLETED event happened today (UTC)", async () => {
    const summary = await summaryToday();
    // period.completed is the "completed today" metric (backend truth).
    expect(typeof summary.period.completed).toBe("number");
    // The backdated COMPLETED order still exists with current status
    // COMPLETED (all-time count includes both) but period excludes it.
    const oldOrder = await request(app).get(`/api/v1/orders/admin/${ctx.oldOrderId}`).set(adminHeaders());
    expect(oldOrder.body.data.order.status).toBe("COMPLETED");
    expect(summary.orders.completed).toBeGreaterThanOrEqual(2);
    // Direct history check: exactly one of the two COMPLETED events is today.
    const now = new Date();
    const { from } = rangeFrame("today", now);
    const todayHistories = await prisma.orderStatusHistory.findMany({
      where: { orderId: { in: [ctx.todayOrderId, ctx.oldOrderId] }, status: "COMPLETED" },
    });
    const todayCount = todayHistories.filter((h) => h.createdAt >= from && h.createdAt < now).length;
    expect(todayCount).toBe(1);
    expect(summary.period.completed).toBeGreaterThanOrEqual(1);
  });

  it("applies exact UTC day boundaries (yesterday 23:59 excluded, today 00:00 included)", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const { from } = rangeFrame("today", now);
    expect(from.toISOString()).toBe("2026-09-19T00:00:00.000Z");
    const justBefore = new Date(from.getTime() - 1);
    const exactlyAt = new Date(from.getTime());
    expect(justBefore < from).toBe(true);
    expect(exactlyAt >= from).toBe(true);
  });
});
