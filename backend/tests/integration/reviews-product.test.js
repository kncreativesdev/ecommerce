import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { companyOneAdminId, stampUserCompany, COMPANY_ONE_ID } from "../helpers/userFixtures.js";

/**
 * Public PDP reviews (GET /reviews/product/:productId).
 * - No approval gate: a submitted customer review is listed immediately
 *   (created approved), with no private customer data.
 * - Admin review mutation endpoints do not exist (read-only admin):
 *   PATCH/DELETE /reviews/admin/:id are 404 ROUTE_NOT_FOUND.
 */

const RUN = `TSTRP${Date.now().toString(36).toUpperCase()}`;
const COMPANY_ONE_ADMIN_ID = await companyOneAdminId();
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: COMPANY_ONE_ADMIN_ID, roles: ["ADMIN"] })}` });

// Phase 2C-26: public reads fail closed on unregistered hosts, so the
// review-list assertion below resolves Company #1 through an explicit
// RUN-unique test domain (removed in afterAll) instead of ambient
// localhost state. Company #1 itself stays read-only.
const PUBLIC_HOST = `${RUN.toLowerCase()}-public.example.test`;
let publicDomainId = null;

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
  customerToken: null,
  addressId: null,
  orderItemId: null,
  reviewId: null,
};

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });

beforeAll(async () => {
  const category = await request(app).post("/api/v1/categories").set(adminHeaders()).send({
    name: `${RUN} Category`,
  });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app).post("/api/v1/products").set(adminHeaders()).send({
    name: `${RUN} Widget`,
    categoryId: ctx.categoryId,
    variants: [{ sku: `${RUN}-SKU`, name: "Standard", price: "40.00" }],
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
    firstName: "Reviewer",
    lastName: "Tester",
    phone: "9999999999",
  });
  expect(registered.status).toBe(201);
  await stampUserCompany(registered.body.data.user.id);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  ctx.customerToken = loggedIn.body.data.accessToken;

  const address = await request(app).post("/api/v1/addresses").set(customerHeaders()).send({
    fullName: "Reviewer Tester",
    phone: "9999999999",
    addressLine1: "1 Test Street",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    country: "India",
  });
  expect(address.status).toBe(201);
  ctx.addressId = address.body.data.address.id;

  const added = await request(app).post("/api/v1/cart/items").set(customerHeaders()).send({
    variantId: ctx.variantId,
    quantity: 1,
  });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
    shippingAddressId: ctx.addressId,
  });
  expect(order.status).toBe(201);
  ctx.orderItemId = order.body.data.order.items[0].id;

  const review = await request(app).post("/api/v1/reviews").set(customerHeaders()).send({
    orderItemId: ctx.orderItemId,
    rating: 5,
    title: `${RUN} Great`,
    comment: `${RUN} Works well`,
  });
  expect(review.status).toBe(201);
  ctx.reviewId = review.body.data.review.id;

  const publicDomain = await prisma.companyDomain.create({
    data: { companyId: COMPANY_ONE_ID, domain: PUBLIC_HOST, isPrimary: false, isActive: true },
  });
  publicDomainId = publicDomain.id;
}, 90000);

afterAll(async () => {
  if (publicDomainId) {
    await prisma.companyDomain.deleteMany({ where: { id: publicDomainId } });
  }
  try {
    // Owner-scoped customer delete (admin review deletion no longer exists).
    if (ctx.reviewId) {
      await request(app).delete(`/api/v1/reviews/${ctx.reviewId}`).set(customerHeaders());
    }
  } catch { /* best-effort */ }
  try {
    // Product lifecycle cleanup (deactivate first, then delete).
    await request(app).patch(`/api/v1/products/${ctx.productId}`).set(adminHeaders()).send({ isActive: false });
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("public product reviews", () => {
  it("lists a submitted review immediately without admin approval", async () => {
    const res = await request(app).get(`/api/v1/reviews/product/${ctx.productId}`).set("Host", PUBLIC_HOST);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const row = res.body.data.find((r) => r.id === ctx.reviewId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ productId: ctx.productId, rating: 5 });
    expect(typeof row.author).toBe("string");
    expect(row.createdAt).toBeDefined();
    // No private fields.
    expect(row.userId).toBeUndefined();
    expect(row.email).toBeUndefined();
    expect(row.orderItemId).toBeUndefined();
    expect(row.isApproved).toBeUndefined();
  });

  it("has no admin approve/reject endpoint (read-only admin)", async () => {
    const approved = await request(app)
      .patch(`/api/v1/reviews/admin/${ctx.reviewId}`)
      .set(adminHeaders())
      .send({ isApproved: true });
    expect(approved.status).toBe(404);
    expect(approved.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("has no admin delete endpoint (read-only admin)", async () => {
    const removed = await request(app)
      .delete(`/api/v1/reviews/admin/${ctx.reviewId}`)
      .set(adminHeaders());
    expect(removed.status).toBe(404);
    expect(removed.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("validates the product id", async () => {
    const res = await request(app).get("/api/v1/reviews/product/not-a-uuid");
    expect(res.status).toBe(422);
  });
});
