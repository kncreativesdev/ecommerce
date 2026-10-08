import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { companyOneAdminId, stampUserCompany } from "../helpers/userFixtures.js";

/**
 * Phase 2C-30 bulk-status contention robustness (live HTTP + MySQL).
 *
 * Two overlapping bulk-status requests race the same orders the way
 * parallel operations did when the MySQL 1213 deadlock (P2034) was
 * observed. Exactly one bulk may commit: the loser observes the
 * winner's commit (pre-validation or in-transaction re-read) and
 * answers 409, never 500 — the transient deadlock victim is retried
 * transparently by `withTransactionRetry`, while genuine conflicts
 * stay 409. Final state is deterministic regardless of interleaving:
 * both orders CONFIRMED, exactly one history row + one notification +
 * one ORDER audit event per order, nothing partial.
 */

const RUN = `TSTBR${Date.now().toString(36).toUpperCase()}`;
const COMPANY_ONE_ADMIN_ID = await companyOneAdminId();
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: COMPANY_ONE_ADMIN_ID, roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
  customerToken: null,
  customerId: null,
  addressId: null,
  orderIds: [],
};

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });

async function placeOrder() {
  const added = await request(app).post("/api/v1/cart/items").set(customerHeaders()).send({
    variantId: ctx.variantId,
    quantity: 1,
  });
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

  const product = await request(app)
    .post("/api/v1/products")
    .set(adminHeaders())
    .send({
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
    firstName: "BulkRetry",
    lastName: "Tester",
    phone: "9999999999",
  });
  expect(registered.status).toBe(201);
  ctx.customerId = registered.body.data.user.id;
  await stampUserCompany(ctx.customerId);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  ctx.customerToken = loggedIn.body.data.accessToken;

  const address = await request(app).post("/api/v1/addresses").set(customerHeaders()).send({
    fullName: "BulkRetry Tester",
    phone: "9999999999",
    addressLine1: "1 Test Street",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    country: "India",
  });
  expect(address.status).toBe(201);
  ctx.addressId = address.body.data.address.id;

  const o1 = await placeOrder();
  const o2 = await placeOrder();
  ctx.orderIds = [o1.id, o2.id];
}, 90000);

afterAll(async () => {
  try {
    await request(app).patch(`/api/v1/products/${ctx.productId}`).set(adminHeaders()).send({ isActive: false });
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("bulk status contention robustness", () => {
  it("overlapping bulks settle to one commit with exactly-once effects per order", async () => {
    const notificationsBefore = await prisma.notification.count({ where: { orderId: { in: ctx.orderIds } } });
    const auditsBefore = await prisma.auditLog.count({
      where: { resource: "ORDER", resourceId: { in: ctx.orderIds }, action: "UPDATED" },
    });
    const bulk = () =>
      request(app).patch("/api/v1/orders/admin/bulk-status").set(adminHeaders()).send({
        orderIds: ctx.orderIds,
        status: "CONFIRMED",
      });
    const [first, second] = await Promise.all([bulk(), bulk()]);
    // Exactly one winner (200); the loser observes the commit and
    // answers 409 — never 500, never a partial application.
    expect([first.status, second.status].sort()).toEqual([200, 409]);

    // Deterministic final state regardless of interleaving: both
    // orders CONFIRMED with exactly one CONFIRMED history row, one
    // new notification, and one new ORDER audit event each.
    for (const id of ctx.orderIds) {
      // eslint-disable-next-line no-await-in-loop
      const row = await prisma.order.findUnique({ where: { id }, select: { status: true } });
      expect(row.status).toBe("CONFIRMED");
      // eslint-disable-next-line no-await-in-loop
      const history = await prisma.orderStatusHistory.findMany({ where: { orderId: id, status: "CONFIRMED" } });
      expect(history).toHaveLength(1);
      expect(history[0].previousStatus).toBe("PENDING");
    }
    expect(await prisma.notification.count({ where: { orderId: { in: ctx.orderIds } } })).toBe(
      notificationsBefore + ctx.orderIds.length
    );
    expect(
      await prisma.auditLog.count({ where: { resource: "ORDER", resourceId: { in: ctx.orderIds }, action: "UPDATED" } })
    ).toBe(auditsBefore + ctx.orderIds.length);
  });

  it("still rejects illegal transitions without retry side effects", async () => {
    // Genuine 409s (not P2034) must not be retried into success: an
    // illegal bulk fails atomically with per-order failures and no writes.
    const res = await request(app)
      .patch("/api/v1/orders/admin/bulk-status")
      .set(adminHeaders())
      .send({ orderIds: ctx.orderIds, status: "COMPLETED" });
    expect(res.status).toBe(409);
    for (const id of ctx.orderIds) {
      // eslint-disable-next-line no-await-in-loop
      const row = await prisma.order.findUnique({ where: { id }, select: { status: true } });
      expect(row.status).toBe("CONFIRMED");
    }
  });
});
