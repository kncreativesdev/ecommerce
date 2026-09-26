import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Admin user + review administration (live MySQL):
 * - GET /users, GET /users/:id, PATCH /users/:id (ADMIN-only, safe
 *   fields, search/isActive/pagination/sort, activate/deactivate with
 *   login gating)
 * - GET /reviews/admin, PATCH /reviews/admin/:id, DELETE
 *   /reviews/admin/:id (ADMIN-only, filters, approve/reject via the real
 *   isApproved boolean, hard delete without touching orders)
 * - Customer review flow is unaffected by moderation state.
 *
 * No user-deletion endpoint exists by design, so registered test users
 * stay as ordinary active rows (same convention as the existing
 * integration suites). Catalog rows are DEACTIVATED afterwards; the test
 * review is removed through the real admin DELETE endpoint.
 */

const RUN = `TSTUR${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
  orderId: null,
  orderItemId: null,
  reviewId: null,
  customerA: null, // reviewer (has order + review)
  customerB: null, // lifecycle target (no orders)
};

async function pngBuffer() {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 160, b: 90 } } })
    .png()
    .toBuffer();
}

async function registerAndLogin(firstName) {
  const email = `${RUN.toLowerCase()}-${firstName.toLowerCase()}@example.test`;
  const registered = await request(app).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    firstName,
    lastName: "Tester",
  });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  return { email, token: loggedIn.body.data.accessToken, id: loggedIn.body.data.user.id };
}

beforeAll(async () => {
  ctx.customerA = await registerAndLogin("Reviewer");
  ctx.customerB = await registerAndLogin("Lifecycle");

  const category = await request(app).post("/api/v1/categories").set(adminHeaders()).send({
    name: `${RUN} Category`,
  });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app)
    .post("/api/v1/products")
    .set(adminHeaders())
    .send({
      name: `${RUN} Gadget`,
      categoryId: ctx.categoryId,
      variants: [{ sku: `${RUN}-STD`, name: "Standard", price: "250.00" }],
    });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  ctx.variantId = product.body.data.product.variants[0].id;

  const inventory = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 10 });
  expect(inventory.status).toBe(201);

  const address = await request(app)
    .post("/api/v1/addresses")
    .set({ Authorization: `Bearer ${ctx.customerA.token}` })
    .send({
      fullName: "Reviewer Tester",
      phone: "9999999999",
      addressLine1: "1 Test Street",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
    });
  expect(address.status).toBe(201);

  const added = await request(app)
    .post("/api/v1/cart/items")
    .set({ Authorization: `Bearer ${ctx.customerA.token}` })
    .send({ variantId: ctx.variantId, quantity: 1 });
  expect(added.status).toBe(200);

  const order = await request(app)
    .post("/api/v1/orders")
    .set({ Authorization: `Bearer ${ctx.customerA.token}` })
    .send({ shippingAddressId: address.body.data.address.id });
  expect(order.status).toBe(201);
  ctx.orderId = order.body.data.order.id;
  ctx.orderItemId = order.body.data.order.items[0].id;

  const review = await request(app)
    .post("/api/v1/reviews")
    .set({ Authorization: `Bearer ${ctx.customerA.token}` })
    .send({ orderItemId: ctx.orderItemId, rating: 5, title: `${RUN} Excellent`, comment: "Works great" });
  expect(review.status).toBe(201);
  ctx.reviewId = review.body.data.review.id;
}, 90000);

afterAll(async () => {
  try {
    if (ctx.reviewId) {
      await request(app).delete(`/api/v1/reviews/admin/${ctx.reviewId}`).set(adminHeaders());
    }
  } catch { /* best-effort */ }
  try {
    // Lifecycle target must be left active (login gating is asserted
    // mid-suite with reactivation inside the test itself).
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

const customerAHeaders = () => ({ Authorization: `Bearer ${ctx.customerA.token}` });

describe("admin user list/detail authorization and shape", () => {
  it("rejects anonymous and customer-role access", async () => {
    const anonymous = await request(app).get("/api/v1/users");
    expect(anonymous.status).toBe(401);

    const customerList = await request(app).get("/api/v1/users").set(customerAHeaders());
    expect(customerList.status).toBe(403);
    expect(customerList.body.error.code).toBe("AUTH_FORBIDDEN");

    const customerDetail = await request(app).get(`/api/v1/users/${ctx.customerA.id}`).set(customerAHeaders());
    expect(customerDetail.status).toBe(403);

    const customerPatch = await request(app)
      .patch(`/api/v1/users/${ctx.customerA.id}`)
      .set(customerAHeaders())
      .send({ isActive: false });
    expect(customerPatch.status).toBe(403);
  });

  it("lists users with pagination meta and safe fields only", async () => {
    const res = await request(app).get("/api/v1/users").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.users)).toBe(true);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20 });
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
    const row = res.body.data.users.find((user) => user.id === ctx.customerA.id);
    expect(row).toMatchObject({ email: ctx.customerA.email, isActive: true });
    expect(row.roles).toContain("CUSTOMER");
    for (const user of res.body.data.users) {
      expect(user).not.toHaveProperty("passwordHash");
      expect(user).not.toHaveProperty("password_hash");
    }
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("supports search, isActive filter, pagination, and sort", async () => {
    const search = await request(app)
      .get(`/api/v1/users?search=${RUN.toLowerCase()}-reviewer`)
      .set(adminHeaders());
    expect(search.status).toBe(200);
    expect(search.body.data.users.length).toBeGreaterThanOrEqual(1);
    expect(search.body.data.users.every((user) => user.email.includes(`${RUN.toLowerCase()}-reviewer`))).toBe(true);

    const active = await request(app).get("/api/v1/users?isActive=true").set(adminHeaders());
    expect(active.status).toBe(200);
    expect(active.body.data.users.every((user) => user.isActive === true)).toBe(true);

    const inactive = await request(app).get("/api/v1/users?isActive=false").set(adminHeaders());
    expect(inactive.status).toBe(200);
    expect(inactive.body.data.users.every((user) => user.isActive === false)).toBe(true);

    const paged = await request(app).get("/api/v1/users?limit=1&page=1").set(adminHeaders());
    expect(paged.status).toBe(200);
    expect(paged.body.data.users).toHaveLength(1);
    expect(paged.body.meta).toMatchObject({ page: 1, limit: 1 });
    expect(paged.body.meta.totalPages).toBeGreaterThanOrEqual(2);

    const oldest = await request(app).get("/api/v1/users?sortOrder=asc&limit=100").set(adminHeaders());
    const newest = await request(app).get("/api/v1/users?sortOrder=desc&limit=100").set(adminHeaders());
    expect(oldest.status).toBe(200);
    expect(newest.status).toBe(200);
    const ascTimes = oldest.body.data.users.map((user) => new Date(user.createdAt).getTime());
    const descTimes = newest.body.data.users.map((user) => new Date(user.createdAt).getTime());
    expect([...ascTimes].sort((a, b) => a - b)).toEqual(ascTimes);
    expect([...descTimes].sort((a, b) => b - a)).toEqual(descTimes);
  });

  it("returns safe user detail and 404/422 for bad ids", async () => {
    const res = await request(app).get(`/api/v1/users/${ctx.customerB.id}`).set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: ctx.customerB.id, email: ctx.customerB.email });
    expect(res.body.data.user).not.toHaveProperty("passwordHash");

    const missing = await request(app)
      .get("/api/v1/users/00000000-0000-0000-0000-000000000000")
      .set(adminHeaders());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("USER_NOT_FOUND");

    const invalid = await request(app).get("/api/v1/users/not-a-uuid").set(adminHeaders());
    expect(invalid.status).toBe(422);
  });
});

describe("admin user lifecycle", () => {
  it("deactivates (login blocked) and reactivates a customer", async () => {
    const deactivated = await request(app)
      .patch(`/api/v1/users/${ctx.customerB.id}`)
      .set(adminHeaders())
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.user).toMatchObject({ id: ctx.customerB.id, isActive: false });

    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ctx.customerB.email, password: "TestPass123!" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("AUTH_ACCOUNT_INACTIVE");

    const reactivated = await request(app)
      .patch(`/api/v1/users/${ctx.customerB.id}`)
      .set(adminHeaders())
      .send({ isActive: true });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.data.user.isActive).toBe(true);

    const loginAgain = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ctx.customerB.email, password: "TestPass123!" });
    expect(loginAgain.status).toBe(200);
  });

  it("rejects empty bodies and unknown users", async () => {
    const empty = await request(app).patch(`/api/v1/users/${ctx.customerB.id}`).set(adminHeaders()).send({});
    expect(empty.status).toBe(422);

    const missing = await request(app)
      .patch("/api/v1/users/00000000-0000-0000-0000-000000000000")
      .set(adminHeaders())
      .send({ isActive: false });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("USER_NOT_FOUND");
  });
});

describe("admin review moderation", () => {
  it("rejects anonymous and customer-role access", async () => {
    const anonymous = await request(app).get("/api/v1/reviews/admin");
    expect(anonymous.status).toBe(401);

    const customerList = await request(app).get("/api/v1/reviews/admin").set(customerAHeaders());
    expect(customerList.status).toBe(403);

    const customerPatch = await request(app)
      .patch(`/api/v1/reviews/admin/${ctx.reviewId}`)
      .set(customerAHeaders())
      .send({ isApproved: true });
    expect(customerPatch.status).toBe(403);

    const customerDelete = await request(app)
      .delete(`/api/v1/reviews/admin/${ctx.reviewId}`)
      .set(customerAHeaders());
    expect(customerDelete.status).toBe(403);
  });

  it("lists reviews with customer, product, and order-item linkage", async () => {
    const res = await request(app).get("/api/v1/reviews/admin").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.reviews)).toBe(true);
    expect(res.body.meta.page).toBe(1);
    const row = res.body.data.reviews.find((review) => review.id === ctx.reviewId);
    expect(row).toMatchObject({
      rating: 5,
      title: `${RUN} Excellent`,
      isApproved: false,
    });
    expect(row.customer).toMatchObject({ id: ctx.customerA.id, email: ctx.customerA.email });
    expect(row.customer).not.toHaveProperty("passwordHash");
    expect(row.product).toMatchObject({ id: ctx.productId });
    expect(row.orderItem).toMatchObject({ id: ctx.orderItemId, orderId: ctx.orderId });
  });

  it("supports status, rating, product, customer, and search filters", async () => {
    const pending = await request(app).get("/api/v1/reviews/admin?isApproved=false").set(adminHeaders());
    expect(pending.status).toBe(200);
    expect(pending.body.data.reviews.some((review) => review.id === ctx.reviewId)).toBe(true);
    expect(pending.body.data.reviews.every((review) => review.isApproved === false)).toBe(true);

    const approved = await request(app).get("/api/v1/reviews/admin?isApproved=true").set(adminHeaders());
    expect(approved.status).toBe(200);
    expect(approved.body.data.reviews.some((review) => review.id === ctx.reviewId)).toBe(false);

    const byRating = await request(app).get("/api/v1/reviews/admin?rating=5").set(adminHeaders());
    expect(byRating.body.data.reviews.some((review) => review.id === ctx.reviewId)).toBe(true);
    const byOtherRating = await request(app).get("/api/v1/reviews/admin?rating=1").set(adminHeaders());
    expect(byOtherRating.body.data.reviews.some((review) => review.id === ctx.reviewId)).toBe(false);

    const byProduct = await request(app)
      .get(`/api/v1/reviews/admin?productId=${ctx.productId}`)
      .set(adminHeaders());
    expect(byProduct.body.data.reviews.some((review) => review.id === ctx.reviewId)).toBe(true);

    const byUser = await request(app)
      .get(`/api/v1/reviews/admin?userId=${ctx.customerA.id}`)
      .set(adminHeaders());
    expect(byUser.body.data.reviews.some((review) => review.id === ctx.reviewId)).toBe(true);

    const bySearch = await request(app)
      .get(`/api/v1/reviews/admin?search=${RUN.toLowerCase()} excellent`)
      .set(adminHeaders());
    expect(bySearch.body.data.reviews.some((review) => review.id === ctx.reviewId)).toBe(true);
  });

  it("approves and rejects via the isApproved boolean (rejected rows stay listed)", async () => {
    const approved = await request(app)
      .patch(`/api/v1/reviews/admin/${ctx.reviewId}`)
      .set(adminHeaders())
      .send({ isApproved: true });
    expect(approved.status).toBe(200);
    expect(approved.body.data.review).toMatchObject({ id: ctx.reviewId, isApproved: true });

    const listed = await request(app).get("/api/v1/reviews/admin?isApproved=true").set(adminHeaders());
    expect(listed.body.data.reviews.some((review) => review.id === ctx.reviewId)).toBe(true);

    const rejected = await request(app)
      .patch(`/api/v1/reviews/admin/${ctx.reviewId}`)
      .set(adminHeaders())
      .send({ isApproved: false });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.review.isApproved).toBe(false);

    const stillListed = await request(app).get("/api/v1/reviews/admin?isApproved=false").set(adminHeaders());
    expect(stillListed.body.data.reviews.some((review) => review.id === ctx.reviewId)).toBe(true);
  });

  it("leaves the customer flow untouched by moderation state", async () => {
    const mine = await request(app).get("/api/v1/reviews/me").set(customerAHeaders());
    expect(mine.status).toBe(200);
    expect(mine.body.data.some((review) => review.id === ctx.reviewId)).toBe(true);
  });

  it("rejects bad moderation input and unknown reviews", async () => {
    const empty = await request(app).patch(`/api/v1/reviews/admin/${ctx.reviewId}`).set(adminHeaders()).send({});
    expect(empty.status).toBe(422);

    const missing = await request(app)
      .patch("/api/v1/reviews/admin/00000000-0000-0000-0000-000000000000")
      .set(adminHeaders())
      .send({ isApproved: true });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("REVIEW_NOT_FOUND");

    const invalid = await request(app)
      .patch("/api/v1/reviews/admin/not-a-uuid")
      .set(adminHeaders())
      .send({ isApproved: true });
    expect(invalid.status).toBe(422);
  });

  it("hard-deletes without touching order records", async () => {
    const removed = await request(app).delete(`/api/v1/reviews/admin/${ctx.reviewId}`).set(adminHeaders());
    expect(removed.status).toBe(200);
    expect(removed.body.data.id).toBe(ctx.reviewId);
    ctx.reviewId = null;

    const repeat = await request(app).delete(`/api/v1/reviews/admin/${ctx.orderItemId}`).set(adminHeaders());
    expect(repeat.status).toBe(404);

    const listed = await request(app).get("/api/v1/reviews/admin").set(adminHeaders());
    expect(listed.body.data.reviews.some((review) => review.orderItemId === ctx.orderItemId)).toBe(false);

    // The purchased order is fully intact — review deletion never mutates orders.
    const order = await request(app).get(`/api/v1/orders/${ctx.orderId}`).set(customerAHeaders());
    expect(order.status).toBe(200);
    expect(order.body.data.order.items).toHaveLength(1);
  });
});
