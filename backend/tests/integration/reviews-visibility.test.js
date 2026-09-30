import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Customer review creation + immediate visibility (no admin approval):
 * - An eligible purchase (own order item) creates a review that is
 *   immediately customer-visible in the product listing.
 * - Ineligible creation (unknown order item, another user's order item)
 *   is rejected with 404 and creates nothing.
 * - Duplicate reviews for the same product/order item are rejected with
 *   409 (existing uniqueness rules unchanged).
 * - Admin read access still lists the review; admin mutation routes do
 *   not exist.
 */

const RUN = `TSTRV${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
  addressId: null,
  reviewerToken: null,
  strangerToken: null,
  orderItemId: null,
  reviewId: null,
};

const reviewerHeaders = () => ({ Authorization: `Bearer ${ctx.reviewerToken}` });
const strangerHeaders = () => ({ Authorization: `Bearer ${ctx.strangerToken}` });

async function registerCustomer(firstName) {
  const email = `${RUN.toLowerCase()}-${firstName.toLowerCase()}@example.test`;
  const registered = await request(app)
    .post("/api/v1/auth/register")
    .send({ email, password: "TestPass123!", firstName, lastName: "Tester", phone: "9999999999" });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  return loggedIn.body.data.accessToken;
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
    variants: [{ sku: `${RUN}-SKU`, name: "Standard", price: "60.00" }],
  });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  ctx.variantId = product.body.data.product.variants[0].id;

  const inventory = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 10 });
  expect(inventory.status).toBe(201);

  ctx.reviewerToken = await registerCustomer("Reviewer");
  ctx.strangerToken = await registerCustomer("Stranger");

  const address = await request(app).post("/api/v1/addresses").set(reviewerHeaders()).send({
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

  const added = await request(app).post("/api/v1/cart/items").set(reviewerHeaders()).send({
    variantId: ctx.variantId,
    quantity: 1,
  });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(reviewerHeaders()).send({
    shippingAddressId: ctx.addressId,
  });
  expect(order.status).toBe(201);
  ctx.orderItemId = order.body.data.order.items[0].id;
}, 90000);

afterAll(async () => {
  try {
    if (ctx.reviewId) {
      await request(app).delete(`/api/v1/reviews/${ctx.reviewId}`).set(reviewerHeaders());
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

describe("customer review creation and immediate visibility", () => {
  it("creates a review for an eligible purchase and lists it immediately", async () => {
    const res = await request(app).post("/api/v1/reviews").set(reviewerHeaders()).send({
      orderItemId: ctx.orderItemId,
      rating: 5,
      title: `${RUN} Great`,
      comment: `${RUN} Works well`,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.review).toMatchObject({ productId: ctx.productId, rating: 5 });
    expect(res.body.data.review.isApproved).toBe(true);
    ctx.reviewId = res.body.data.review.id;

    const listed = await request(app).get(`/api/v1/reviews/product/${ctx.productId}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((r) => r.id === ctx.reviewId)).toBe(true);
  });

  it("rejects unknown order items without creating a review", async () => {
    const res = await request(app).post("/api/v1/reviews").set(reviewerHeaders()).send({
      orderItemId: "00000000-0000-0000-0000-000000000000",
      rating: 4,
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("REVIEW_ORDER_ITEM_NOT_FOUND");
  });

  it("rejects another user's order item (cross-user manipulation)", async () => {
    const res = await request(app).post("/api/v1/reviews").set(strangerHeaders()).send({
      orderItemId: ctx.orderItemId,
      rating: 1,
      comment: "Hijacked review",
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("REVIEW_ORDER_ITEM_NOT_FOUND");

    // No review was created for the stranger.
    const mine = await request(app).get("/api/v1/reviews/me").set(strangerHeaders());
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(0);
  });

  it("enforces the one-review-per-product rule with 409", async () => {
    const res = await request(app).post("/api/v1/reviews").set(reviewerHeaders()).send({
      orderItemId: ctx.orderItemId,
      rating: 3,
      comment: "Second attempt",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REVIEW_ALREADY_EXISTS");
  });

  it("keeps admin read access while admin mutations stay unavailable", async () => {
    const list = await request(app).get("/api/v1/reviews/admin").set(adminHeaders());
    expect(list.status).toBe(200);
    expect(list.body.data.reviews.some((review) => review.id === ctx.reviewId)).toBe(true);

    const patch = await request(app)
      .patch(`/api/v1/reviews/admin/${ctx.reviewId}`)
      .set(adminHeaders())
      .send({ isApproved: false });
    expect(patch.status).toBe(404);

    const remove = await request(app).delete(`/api/v1/reviews/admin/${ctx.reviewId}`).set(adminHeaders());
    expect(remove.status).toBe(404);

    // Still visible after the rejected admin mutations.
    const listed = await request(app).get(`/api/v1/reviews/product/${ctx.productId}`);
    expect(listed.body.data.some((r) => r.id === ctx.reviewId)).toBe(true);
  });
});
