import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Admin order search by product name (GET /orders/admin?search=):
 * - A product-name substring matches orders containing that product
 *   (immutable item snapshot — later renames never rewrite history).
 * - Unrelated terms match nothing; existing criteria (order number,
 *   customer email) keep working; pagination meta stays intact.
 */

const RUN = `TSTOS${Date.now().toString(36).toUpperCase()}`;
const PRODUCT_NAME = `${RUN} Searchable Widget`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
  addressId: null,
  customerToken: null,
  customerEmail: null,
  orderId: null,
  orderNumber: null,
};

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });

beforeAll(async () => {
  const category = await request(app).post("/api/v1/categories").set(adminHeaders()).send({
    name: `${RUN} Category`,
  });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app).post("/api/v1/products").set(adminHeaders()).send({
    name: PRODUCT_NAME,
    categoryId: ctx.categoryId,
    variants: [{ sku: `${RUN}-SKU`, name: "Standard", price: "100.00" }],
  });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  ctx.variantId = product.body.data.product.variants[0].id;

  const inventory = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 10 });
  expect(inventory.status).toBe(201);

  ctx.customerEmail = `${RUN.toLowerCase()}@example.test`;
  const registered = await request(app).post("/api/v1/auth/register").send({
    email: ctx.customerEmail,
    password: "TestPass123!",
    firstName: "Search",
    lastName: "Tester",
    phone: "9999999999",
  });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: ctx.customerEmail, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  ctx.customerToken = loggedIn.body.data.accessToken;

  const address = await request(app).post("/api/v1/addresses").set(customerHeaders()).send({
    fullName: "Search Tester",
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
  ctx.orderId = order.body.data.order.id;
  ctx.orderNumber = order.body.data.order.orderNumber;
}, 90000);

afterAll(async () => {
  // Product lifecycle cleanup (deactivate first, then delete).
  try {
    await request(app).patch(`/api/v1/products/${ctx.productId}`).set(adminHeaders()).send({ isActive: false });
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("admin order search by product name", () => {
  it("matches orders containing the searched product name", async () => {
    const res = await request(app)
      .get(`/api/v1/orders/admin?search=${RUN.toLowerCase()} searchable`)
      .set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.orders.some((order) => order.id === ctx.orderId)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.meta).toMatchObject({ page: 1 });
  });

  it("matches nothing for an unrelated product name", async () => {
    const res = await request(app)
      .get(`/api/v1/orders/admin?search=${RUN.toLowerCase()}-no-such-product`)
      .set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.orders.some((order) => order.id === ctx.orderId)).toBe(false);
  });

  it("keeps the existing criteria working (order number, customer email)", async () => {
    const byNumber = await request(app)
      .get(`/api/v1/orders/admin?search=${ctx.orderNumber}`)
      .set(adminHeaders());
    expect(byNumber.status).toBe(200);
    expect(byNumber.body.data.orders.some((order) => order.id === ctx.orderId)).toBe(true);

    const byEmail = await request(app)
      .get(`/api/v1/orders/admin?search=${ctx.customerEmail}`)
      .set(adminHeaders());
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.data.orders.some((order) => order.id === ctx.orderId)).toBe(true);
  });
});
