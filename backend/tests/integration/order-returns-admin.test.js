import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { companyOneAdminId, stampUserCompany } from "../helpers/userFixtures.js";

/**
 * Admin return-request reads (live MySQL):
 * GET /returns (ADMIN list with status/search pagination) and
 * GET /returns/:id (ADMIN detail with customer/order/history expansion).
 * No status-mutation endpoint exists in the backend workflow — the admin
 * surface is intentionally read-only.
 */

const RUN = `TSTRA${Date.now().toString(36).toUpperCase()}`;
const COMPANY_ONE_ADMIN_ID = await companyOneAdminId();
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: COMPANY_ONE_ADMIN_ID, roles: ["ADMIN"] })}` });

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
  customerA: null,
  customerB: null,
  returnAId: null,
  returnBId: null,
  orderAId: null,
};

async function registerCustomer(tag) {
  const email = `${RUN.toLowerCase()}-${tag}@example.test`;
  const registered = await request(app).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    firstName: "Return",
    lastName: "Admin",
    phone: "9999999999",
  });
  expect(registered.status).toBe(201);
  await stampUserCompany(registered.body.data.user.id);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  const address = await request(app)
    .post("/api/v1/addresses")
    .set({ Authorization: `Bearer ${loggedIn.body.data.accessToken}` })
    .send({
      fullName: "Return Admin",
      phone: "9999999999",
      addressLine1: "1 Test Street",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
    });
  expect(address.status).toBe(201);
  return { email, token: loggedIn.body.data.accessToken, addressId: address.body.data.address.id };
}

const headersFor = (customer) => ({ Authorization: `Bearer ${customer.token}` });

async function placeDeliveredOrder(customer) {
  const added = await request(app).post("/api/v1/cart/items").set(headersFor(customer)).send({
    variantId: ctx.variantId,
    quantity: 1,
  });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(headersFor(customer)).send({
    shippingAddressId: customer.addressId,
  });
  expect(order.status).toBe(201);
  for (const status of DELIVERY_WALK) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app)
      .patch(`/api/v1/orders/admin/${order.body.data.order.id}/status`)
      .set(adminHeaders())
      .send({ status });
    expect(res.status).toBe(200);
  }
  return order.body.data.order;
}

async function requestReturn(customer, orderId, reason = "DAMAGED", details = null) {
  const body = { reason };
  if (details !== null) body.details = details;
  const res = await request(app).post(`/api/v1/orders/${orderId}/returns`).set(headersFor(customer)).send(body);
  expect(res.status).toBe(201);
  return res.body.data.returnRequest;
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
    .send({ quantity: 100 });
  expect(inv.status).toBe(201);

  ctx.customerA = await registerCustomer("alice");
  ctx.customerB = await registerCustomer("bob");

  const orderA = await placeDeliveredOrder(ctx.customerA);
  ctx.orderAId = orderA.id;
  const createdA = await requestReturn(ctx.customerA, orderA.id, "DAMAGED", "Box was crushed.");
  ctx.returnAId = createdA.id;

  const orderB = await placeDeliveredOrder(ctx.customerB);
  const createdB = await requestReturn(ctx.customerB, orderB.id, "WRONG_SIZE");
  ctx.returnBId = createdB.id;
}, 120000);

afterAll(async () => {
  try {
    await request(app).patch(`/api/v1/products/${ctx.productId}`).set(adminHeaders()).send({ isActive: false });
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("admin return list", () => {
  it("lists returns with order/customer expansion and pagination envelope", async () => {
    const res = await request(app).get("/api/v1/returns").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, total: expect.any(Number) });
    const rows = res.body.data.returns.filter((row) =>
      [ctx.returnAId, ctx.returnBId].includes(row.id)
    );
    expect(rows).toHaveLength(2);
    const rowA = rows.find((row) => row.id === ctx.returnAId);
    expect(rowA).toMatchObject({ status: "REQUESTED", reason: "DAMAGED", details: "Box was crushed." });
    expect(rowA.customer).toMatchObject({ email: ctx.customerA.email });
    expect(rowA.customer).not.toHaveProperty("passwordHash");
    expect(rowA.order).toMatchObject({ id: ctx.orderAId, status: "DELIVERED" });
    expect(rowA.order.grandTotal).toBe("100.00");
  });

  it("rejects unauthenticated and non-admin readers", async () => {
    expect((await request(app).get("/api/v1/returns")).status).toBe(401);
    expect((await request(app).get("/api/v1/returns").set(headersFor(ctx.customerA))).status).toBe(403);
    expect((await request(app).get(`/api/v1/returns/${ctx.returnAId}`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/returns/${ctx.returnAId}`).set(headersFor(ctx.customerA))).status).toBe(
      403
    );
  });

  it("paginates deterministically", async () => {
    const first = await request(app).get("/api/v1/returns?limit=1&page=1").set(adminHeaders());
    expect(first.status).toBe(200);
    expect(first.body.data.returns).toHaveLength(1);
    expect(first.body.meta.totalPages).toBeGreaterThanOrEqual(2);

    const second = await request(app).get("/api/v1/returns?limit=1&page=2").set(adminHeaders());
    expect(second.status).toBe(200);
    const firstIds = first.body.data.returns.map((row) => row.id);
    for (const row of second.body.data.returns) {
      expect(firstIds).not.toContain(row.id);
    }
  });

  it("filters by return status", async () => {
    const requested = await request(app).get("/api/v1/returns?status=REQUESTED").set(adminHeaders());
    expect(requested.status).toBe(200);
    expect(requested.body.data.returns.length).toBeGreaterThanOrEqual(2);
    for (const row of requested.body.data.returns) {
      expect(row.status).toBe("REQUESTED");
    }

    const approved = await request(app).get("/api/v1/returns?status=APPROVED").set(adminHeaders());
    expect(approved.status).toBe(200);
    expect(approved.body.data.returns).toHaveLength(0);
  });

  it("searches order numbers and customer identity", async () => {
    const orderNumber = (await request(app).get(`/api/v1/orders/${ctx.orderAId}`).set(headersFor(ctx.customerA))).body
      .data.order.orderNumber;

    const byOrder = await request(app).get(`/api/v1/returns?search=${orderNumber}`).set(adminHeaders());
    expect(byOrder.status).toBe(200);
    expect(byOrder.body.data.returns.map((row) => row.id)).toContain(ctx.returnAId);

    const byEmail = await request(app).get(`/api/v1/returns?search=${ctx.customerB.email}`).set(adminHeaders());
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.data.returns.map((row) => row.id)).toContain(ctx.returnBId);
    expect(byEmail.body.data.returns.map((row) => row.id)).not.toContain(ctx.returnAId);
  });
});

describe("admin return detail", () => {
  it("returns the request with customer, order, and history expansion", async () => {
    const res = await request(app).get(`/api/v1/returns/${ctx.returnAId}`).set(adminHeaders());
    expect(res.status).toBe(200);
    const body = res.body.data.returnRequest;
    expect(body).toMatchObject({
      id: ctx.returnAId,
      orderId: ctx.orderAId,
      status: "REQUESTED",
      reason: "DAMAGED",
      details: "Box was crushed.",
    });
    expect(body.customer).toMatchObject({ email: ctx.customerA.email, phone: "9999999999" });
    expect(body.order).toMatchObject({ id: ctx.orderAId, status: "DELIVERED" });
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ status: "REQUESTED" });
  });

  it("returns 404 for unknown return requests", async () => {
    const res = await request(app)
      .get("/api/v1/returns/00000000-0000-0000-0000-000000000000")
      .set(adminHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("RETURN_NOT_FOUND");
  });

  it("exposes no status-mutation endpoint", async () => {
    const res = await request(app).patch(`/api/v1/returns/${ctx.returnAId}`).set(adminHeaders()).send({
      status: "APPROVED",
    });
    expect(res.status).toBe(404);
  });
});
