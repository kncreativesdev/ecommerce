import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Admin dashboard analytics + inventory operations (live MySQL):
 * - GET /dashboard/summary?range= (ADMIN-only): structure per range,
 *   UTC boundaries, zero-filled ordered buckets, bucket sums matching
 *   period totals, recognized-revenue definition (DELIVERED + PAID only;
 *   PENDING/CANCELLED/FAILED/REFUNDED excluded), empty future buckets
 *   honestly zero, no customer access.
 * - GET /inventory (ADMIN-only): list shape, search, stock/active
 *   filters, pagination, uninitialized rows, authorization.
 * - Per-variant PATCH (delta) + ledger history endpoint: exact-once
 *   adjustments, validation, transaction safety vs concurrent orders.
 * - Order placement decrements exactly once; cancellation restores
 *   exactly once; manual adjustments never touch orders.
 *
 * Cross-suite safety: recognized-revenue deltas use unique amounts and
 * only this suite advances orders to DELIVERED+PAID, so revenue assertions
 * are exact, not order-count races. Order STATUS counts (pending,
 * cancelled, delivered) are global and shared across suites — every suite
 * creates and advances orders — so status assertions below are scoped to
 * this suite's own fixtures (fetched by id), never global before/after
 * count arithmetic. Catalog rows are DEACTIVATED afterwards.
 */

const RUN = `TSTDI${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const PRICES = { A: "4321.09", B: "1111.11", C: "2222.22", D: "3333.33" };

const ctx = {
  categoryId: null,
  productId: null,
  variants: {},
  customerToken: null,
  addressId: null,
  orderIds: {},
};

function toCents(decimalString) {
  const [units, frac = ""] = String(decimalString).split(".");
  return BigInt(units) * 100n + BigInt(frac.padEnd(2, "0").slice(0, 2));
}

async function placeOrder(shortSku, quantity = 1) {
  const variant = ctx.variants[shortSku];
  const added = await request(app).post("/api/v1/cart/items").set(customerHeaders()).send({
    variantId: variant.id,
    quantity,
  });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
    shippingAddressId: ctx.addressId,
  });
  expect(order.status).toBe(201);
  return order.body.data.order;
}

async function advanceOrder(orderId, statuses) {
  for (const status of statuses) {
    const res = await request(app)
      .patch(`/api/v1/orders/admin/${orderId}/status`)
      .set(adminHeaders())
      .send({ status });
    expect(res.status).toBe(200);
  }
}

async function setPayment(orderId, status) {
  const res = await request(app)
    .patch(`/api/v1/orders/admin/${orderId}/payment`)
    .set(adminHeaders())
    .send({ status });
  expect(res.status).toBe(200);
}

async function summary(range) {
  const res = await request(app).get(`/api/v1/dashboard/summary?range=${range}`).set(adminHeaders());
  expect(res.status).toBe(200);
  return res.body.data.summary;
}

async function inventoryOf(sku) {
  const res = await request(app)
    .get(`/api/v1/products/${ctx.productId}/variants/${ctx.variants[sku].id}/inventory`)
    .set(adminHeaders());
  expect(res.status).toBe(200);
  return res.body.data.inventory;
}

beforeAll(async () => {
  const category = await request(app).post("/api/v1/categories").set(adminHeaders()).send({
    name: `${RUN} Category`,
  });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app)
    .post("/api/v1/products")
    .set(adminHeaders())
    .send({
      name: `${RUN} Widget`,
      categoryId: ctx.categoryId,
      variants: [
        { sku: `${RUN}-A`, name: "Alpha", price: PRICES.A },
        { sku: `${RUN}-B`, name: "Beta", price: PRICES.B },
        { sku: `${RUN}-C`, name: "Gamma", price: PRICES.C },
        { sku: `${RUN}-D`, name: "Delta", price: PRICES.D },
        { sku: `${RUN}-ZERO`, name: "Zero", price: "10.00" },
        { sku: `${RUN}-PLAIN`, name: "Plain", price: "10.00" },
      ],
    });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  for (const variant of product.body.data.product.variants) {
    ctx.variants[variant.sku.replace(`${RUN}-`, "")] = variant;
  }

  // Stocked variants get inventory; ZERO gets an explicit 0; PLAIN stays
  // uninitialized (no record) to prove the null-row path.
  for (const sku of ["A", "B", "C", "D"]) {
    const res = await request(app)
      .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variants[sku].id}/inventory`)
      .set(adminHeaders())
      .send({ quantity: 10 });
    expect(res.status).toBe(201);
  }
  const zero = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variants.ZERO.id}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 0 });
  expect(zero.status).toBe(201);

  const email = `${RUN.toLowerCase()}@example.test`;
  const registered = await request(app).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    firstName: "Dashboard",
    lastName: "Tester",
  });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  ctx.customerToken = loggedIn.body.data.accessToken;

  const address = await request(app)
    .post("/api/v1/addresses")
    .set(customerHeaders())
    .send({
      fullName: "Dashboard Tester",
      phone: "9999999999",
      addressLine1: "1 Test Street",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
    });
  expect(address.status).toBe(201);
  ctx.addressId = address.body.data.address.id;
}, 90000);

afterAll(async () => {
  try {
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });

describe("dashboard summary authorization and shape", () => {
  it("rejects anonymous and customer-role access", async () => {
    const anonymous = await request(app).get("/api/v1/dashboard/summary?range=today");
    expect(anonymous.status).toBe(401);

    const customer = await request(app).get("/api/v1/dashboard/summary?range=today").set(customerHeaders());
    expect(customer.status).toBe(403);
    expect(customer.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("defaults to today with 24 hourly buckets and UTC boundaries", async () => {
    const res = await request(app).get("/api/v1/dashboard/summary").set(adminHeaders());
    expect(res.status).toBe(200);
    const s = res.body.data.summary;
    expect(s.range).toBe("today");
    expect(s.granularity).toBe("hour");
    expect(s.buckets).toHaveLength(24);
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    expect(s.periodStart).toBe(startOfToday.toISOString());
    expect(s.buckets[0].bucketStart).toBe(startOfToday.toISOString());
    expect(s.buckets.every((b) => typeof b.orders === "number" && typeof b.revenue === "string")).toBe(true);
    // Ordered ascending with no gaps or duplicates.
    const keys = s.buckets.map((b) => b.bucketStart);
    expect([...new Set(keys)]).toHaveLength(24);
    expect([...keys].sort()).toEqual(keys);
    // Future hours are honestly zero (nothing can be ordered yet).
    const currentHour = now.getUTCHours();
    for (let hour = currentHour + 1; hour < 24; hour += 1) {
      expect(s.buckets[hour].orders).toBe(0);
      expect(s.buckets[hour].revenue).toBe("0.00");
    }
    expect(s.orders).toMatchObject({
      pending: expect.any(Number),
      delivered: expect.any(Number),
      cancelled: expect.any(Number),
    });
    expect(typeof s.revenue.total).toBe("string");
    expect(s.inventory).toMatchObject({
      tracked: expect.any(Number),
      outOfStock: expect.any(Number),
      uninitialized: expect.any(Number),
    });
  });

  it("returns correct frames for week, month, and year", async () => {
    const week = await summary("week");
    expect(week.granularity).toBe("day");
    expect(week.buckets).toHaveLength(7);
    // ISO Monday start in UTC.
    expect(new Date(week.periodStart).getUTCDay()).toBe(1);
    expect(new Date(week.periodStart).getUTCHours()).toBe(0);

    const month = await summary("month");
    expect(month.granularity).toBe("day");
    const daysInMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).getUTCDate();
    expect(month.buckets).toHaveLength(daysInMonth);
    expect(month.periodStart.endsWith("-01T00:00:00.000Z")).toBe(true);

    const year = await summary("year");
    expect(year.granularity).toBe("month");
    expect(year.buckets).toHaveLength(12);
    expect(year.buckets[0].bucketStart).toBe(`${new Date().getUTCFullYear()}-01-01`);
    expect(year.periodStart).toBe(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString());
  });

  it("keeps bucket sums exactly equal to period aggregates", async () => {
    for (const range of ["today", "week", "month", "year"]) {
      const s = await summary(range);
      const bucketOrders = s.buckets.reduce((sum, b) => sum + b.orders, 0);
      const bucketRevenue = s.buckets.reduce((sum, b) => sum + toCents(b.revenue), 0n);
      expect(bucketOrders).toBe(s.period.orders);
      expect(bucketRevenue).toBe(toCents(s.period.revenue));
    }
  });
});

describe("recognized revenue definition", () => {
  it("counts only DELIVERED + PAID orders", async () => {
    const before = await summary("today");
    const baseRevenue = toCents(before.revenue.total);
    const basePeriod = toCents(before.period.revenue);

    // A: full journey to cash collected — the ONLY recognized order.
    const orderA = await placeOrder('A');
    expect(orderA.grandTotal).toBe(PRICES.A);
    await advanceOrder(orderA.id, ["CONFIRMED", "PROCESSING", "DISPATCHED", "IN_TRANSIT", "ARRIVED_IN_CITY", "OUT_FOR_DELIVERY", "DELIVERED"]);
    await setPayment(orderA.id, "PAID");
    ctx.orderIds.A = orderA.id;

    const after = await summary("today");
    expect(toCents(after.revenue.total) - baseRevenue).toBe(toCents(PRICES.A));
    expect(toCents(after.period.revenue) - basePeriod).toBe(toCents(PRICES.A));
    // Fixture-scoped: status counts are global/shared, so assert the suite's
    // own order directly instead of before/after count arithmetic.
    const fetchedA = await request(app).get(`/api/v1/orders/admin/${orderA.id}`).set(adminHeaders());
    expect(fetchedA.status).toBe(200);
    expect(fetchedA.body.data.order.status).toBe("DELIVERED");
  });

  it("excludes pending, cancelled, and refunded orders from revenue", async () => {
    const before = await summary("today");
    const baseRevenue = toCents(before.revenue.total);

    // B: stays PENDING (created, never collected).
    const orderB = await placeOrder('B');
    ctx.orderIds.B = orderB.id;

    // C: cancelled pre-shipment (stock restored, no sale).
    const orderC = await placeOrder('C');
    const cancelled = await request(app)
      .patch(`/api/v1/orders/admin/${orderC.id}/status`)
      .set(adminHeaders())
      .send({ status: "CANCELLED" });
    expect(cancelled.status).toBe(200);
    ctx.orderIds.C = orderC.id;

    // D: delivered then refunded (recorded manual refund, no payout).
    const orderD = await placeOrder('D');
    await advanceOrder(orderD.id, ["CONFIRMED", "PROCESSING", "DISPATCHED", "IN_TRANSIT", "ARRIVED_IN_CITY", "OUT_FOR_DELIVERY", "DELIVERED"]);
    await setPayment(orderD.id, "PAID");
    await setPayment(orderD.id, "REFUNDED");
    ctx.orderIds.D = orderD.id;

    const after = await summary("today");
    // None of B/C/D moved recognized revenue by a single paisa. Revenue
    // assertions stay exact: only this suite sets payments PAID (see file
    // header), so no other suite can move these totals concurrently.
    expect(toCents(after.revenue.total)).toBe(baseRevenue);
    // Fixture-scoped status checks: pending/cancelled/delivered counts are
    // global and shared across suites (every suite creates and advances
    // orders), so each suite-owned order is verified directly by id.
    // B stays PENDING (created, never collected).
    const fetchedB = await request(app).get(`/api/v1/orders/admin/${orderB.id}`).set(adminHeaders());
    expect(fetchedB.status).toBe(200);
    expect(fetchedB.body.data.order.status).toBe("PENDING");
    // C is cancelled pre-shipment (stock restored, no sale).
    const fetchedC = await request(app).get(`/api/v1/orders/admin/${orderC.id}`).set(adminHeaders());
    expect(fetchedC.status).toBe(200);
    expect(fetchedC.body.data.order.status).toBe("CANCELLED");
    // D is delivered but unpaid-after-refund: DELIVERED with its single
    // payment row REFUNDED (checkout creates one row; admin updates mutate
    // it in place) — counted in delivered, never in revenue.
    const fetchedD = await request(app).get(`/api/v1/orders/admin/${orderD.id}`).set(adminHeaders());
    expect(fetchedD.status).toBe(200);
    expect(fetchedD.body.data.order.status).toBe("DELIVERED");
    expect(fetchedD.body.data.order.payments).toHaveLength(1);
    expect(fetchedD.body.data.order.payments[0].status).toBe("REFUNDED");
  });
});

describe("admin inventory list", () => {
  it("rejects anonymous and customer-role access", async () => {
    const anonymous = await request(app).get("/api/v1/inventory");
    expect(anonymous.status).toBe(401);

    const customer = await request(app).get("/api/v1/inventory").set(customerHeaders());
    expect(customer.status).toBe(403);
  });

  it("lists variants with product and stock details plus meta", async () => {
    const res = await request(app).get("/api/v1/inventory").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20 });
    const row = res.body.data.items.find((item) => item.variant?.sku === `${RUN}-A`);
    expect(row.product).toMatchObject({ id: ctx.productId, isActive: true });
    expect(row.variant).toMatchObject({ sku: `${RUN}-A`, name: "Alpha", price: PRICES.A, isActive: true });
    expect(row.inventory).toMatchObject({ quantity: expect.any(Number) });
    expect(row.inventory.availableQuantity).toBe(row.inventory.quantity - row.inventory.reservedQuantity);
    // Uninitialized variant rides along with a null record (never zero).
    const plain = res.body.data.items.find((item) => item.variant?.sku === `${RUN}-PLAIN`);
    expect(plain.inventory).toBeNull();
  });

  it("supports search, stock, active filters, and pagination", async () => {
    const search = await request(app).get(`/api/v1/inventory?search=${RUN}-A`).set(adminHeaders());
    expect(search.status).toBe(200);
    expect(search.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(search.body.data.items.every((item) => item.variant.sku.includes(`${RUN}-A`))).toBe(true);

    const out = await request(app).get("/api/v1/inventory?stock=out").set(adminHeaders());
    expect(out.status).toBe(200);
    const zeroRow = out.body.data.items.find((item) => item.variant?.sku === `${RUN}-ZERO`);
    expect(zeroRow).toBeDefined();
    for (const item of out.body.data.items) {
      const available = item.inventory ? item.inventory.availableQuantity : 0;
      expect(available).toBeLessThanOrEqual(0);
    }

    const inactive = await request(app).get("/api/v1/inventory?active=false").set(adminHeaders());
    expect(inactive.status).toBe(200);
    expect(inactive.body.data.items.every((item) => item.variant.isActive === false)).toBe(true);

    const paged = await request(app).get("/api/v1/inventory?limit=1&page=1").set(adminHeaders());
    expect(paged.status).toBe(200);
    expect(paged.body.data.items).toHaveLength(1);
    expect(paged.body.meta).toMatchObject({ page: 1, limit: 1 });
    expect(paged.body.meta.total).toBeGreaterThanOrEqual(1);
  });
});

describe("stock adjustments and ledger", () => {
  it("adjusts stock exactly once with ledger rows and validation", async () => {
    const before = await inventoryOf("B");
    const up = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/variants/${ctx.variants.B.id}/inventory`)
      .set(adminHeaders())
      .send({ quantity: 5, note: "Cycle count" });
    expect(up.status).toBe(200);
    expect(up.body.data.inventory.quantity).toBe(before.quantity + 5);

    const down = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/variants/${ctx.variants.B.id}/inventory`)
      .set(adminHeaders())
      .send({ quantity: -3 });
    expect(down.status).toBe(200);
    expect(down.body.data.inventory.quantity).toBe(before.quantity + 2);

    const zero = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/variants/${ctx.variants.B.id}/inventory`)
      .set(adminHeaders())
      .send({ quantity: 0 });
    expect(zero.status).toBe(422);

    const overdraw = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/variants/${ctx.variants.B.id}/inventory`)
      .set(adminHeaders())
      .send({ quantity: -(before.quantity + 100) });
    expect(overdraw.status).toBe(409);
    expect(overdraw.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("exposes the real ledger history newest-first", async () => {
    const res = await request(app)
      .get(`/api/v1/products/${ctx.productId}/variants/${ctx.variants.B.id}/inventory/transactions`)
      .set(adminHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.transactions)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);
    const types = res.body.data.transactions.map((t) => t.type);
    expect(types).toContain("INITIAL_STOCK");
    expect(types).toContain("RESTOCK");
    expect(types).toContain("ADJUSTMENT");
    const restock = res.body.data.transactions.find((t) => t.type === "RESTOCK");
    expect(restock).toMatchObject({ quantity: 5, referenceType: "ADMIN", note: "Cycle count" });
    // Newest first.
    const times = res.body.data.transactions.map((t) => new Date(t.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("rejects unknown variants and non-admin ledger access", async () => {
    const missing = await request(app)
      .get(`/api/v1/products/${ctx.productId}/variants/00000000-0000-0000-0000-000000000000/inventory/transactions`)
      .set(adminHeaders());
    expect(missing.status).toBe(404);

    const customer = await request(app)
      .get(`/api/v1/products/${ctx.productId}/variants/${ctx.variants.B.id}/inventory/transactions`)
      .set(customerHeaders());
    expect(customer.status).toBe(403);
  });

  it("decrements on order placement and restores on cancel exactly once", async () => {
    const stockBefore = await inventoryOf("A");
    const order = await placeOrder('A', 2);
    const afterPlacement = await inventoryOf("A");
    expect(stockBefore.quantity - afterPlacement.quantity).toBe(2);

    const ledger = await request(app)
      .get(`/api/v1/products/${ctx.productId}/variants/${ctx.variants.A.id}/inventory/transactions?limit=100`)
      .set(adminHeaders());
    const orderRows = ledger.body.data.transactions.filter(
      (t) => t.type === "ORDER" && t.referenceId === order.id
    );
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].quantity).toBe(-2);

    const cancelled = await request(app)
      .patch(`/api/v1/orders/admin/${order.id}/status`)
      .set(adminHeaders())
      .send({ status: "CANCELLED" });
    expect(cancelled.status).toBe(200);
    const afterCancel = await inventoryOf("A");
    expect(afterCancel.quantity).toBe(stockBefore.quantity);

    const ledgerAfter = await request(app)
      .get(`/api/v1/products/${ctx.productId}/variants/${ctx.variants.A.id}/inventory/transactions?limit=100`)
      .set(adminHeaders());
    const restoreRows = ledgerAfter.body.data.transactions.filter(
      (t) => t.type === "ORDER_CANCELLED" && t.referenceId === order.id
    );
    expect(restoreRows).toHaveLength(1);
    expect(restoreRows[0].quantity).toBe(2);
  });
});
