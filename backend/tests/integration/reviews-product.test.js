import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Public PDP reviews (GET /reviews/product/:productId).
 * - Approved reviews only, no auth, no private customer data.
 * - Unapproved reviews stay hidden until moderated.
 */

const RUN = `TSTRP${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

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
  });
  expect(registered.status).toBe(201);
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
}, 90000);

afterAll(async () => {
  try {
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("public product reviews", () => {
  it("hides unapproved reviews from the public listing", async () => {
    const res = await request(app).get(`/api/v1/reviews/product/${ctx.productId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((r) => r.id === ctx.reviewId)).toBe(false);
  });

  it("publishes approved reviews without private customer data", async () => {
    const approved = await request(app)
      .patch(`/api/v1/reviews/admin/${ctx.reviewId}`)
      .set(adminHeaders())
      .send({ isApproved: true });
    expect(approved.status).toBe(200);

    const res = await request(app).get(`/api/v1/reviews/product/${ctx.productId}`);
    expect(res.status).toBe(200);
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

  it("validates the product id", async () => {
    const res = await request(app).get("/api/v1/reviews/product/not-a-uuid");
    expect(res.status).toBe(422);
  });
});
