import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Stock availability as backend truth.
 * - GET /products variants carry boolean `inStock` (no quantities exposed).
 * - Variants with no inventory record are out of stock and cart-adds fail
 *   with 409 INSUFFICIENT_STOCK (never silently allowed).
 */

const RUN = `TSTSK${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  stockedVariantId: null,
  emptyVariantId: null,
  plainVariantId: null,
  customerToken: null,
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
    variants: [
      { sku: `${RUN}-STOCKED`, name: "Stocked", price: "10.00" },
      { sku: `${RUN}-EMPTY`, name: "Empty", price: "10.00" },
      { sku: `${RUN}-PLAIN`, name: "Plain", price: "10.00" },
    ],
  });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  for (const v of product.body.data.product.variants) {
    if (v.sku === `${RUN}-STOCKED`) ctx.stockedVariantId = v.id;
    if (v.sku === `${RUN}-EMPTY`) ctx.emptyVariantId = v.id;
    if (v.sku === `${RUN}-PLAIN`) ctx.plainVariantId = v.id;
  }

  const stocked = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.stockedVariantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 5 });
  expect(stocked.status).toBe(201);
  const empty = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.emptyVariantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 0 });
  expect(empty.status).toBe(201);
  // PLAIN stays uninitialized (no record).

  const email = `${RUN.toLowerCase()}@example.test`;
  const registered = await request(app).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    firstName: "Stock",
    lastName: "Tester",
  });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  ctx.customerToken = loggedIn.body.data.accessToken;
}, 90000);

afterAll(async () => {
  try {
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("product availability", () => {
  it("exposes boolean inStock per variant without quantities", async () => {
    const res = await request(app).get(`/api/v1/products/${ctx.productId}`);
    expect(res.status).toBe(200);
    const bySku = Object.fromEntries(res.body.data.product.variants.map((v) => [v.sku, v]));
    expect(bySku[`${RUN}-STOCKED`].inStock).toBe(true);
    expect(bySku[`${RUN}-EMPTY`].inStock).toBe(false);
    expect(bySku[`${RUN}-PLAIN`].inStock).toBe(false);
    for (const v of res.body.data.product.variants) {
      expect(v.quantity).toBeUndefined();
      expect(v.reservedQuantity).toBeUndefined();
    }
  });

  it("rejects cart adds for uninitialized (no-record) variants as out of stock", async () => {
    const res = await request(app).post("/api/v1/cart/items").set(customerHeaders()).send({
      variantId: ctx.plainVariantId,
      quantity: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("rejects cart adds exceeding available stock", async () => {
    const res = await request(app).post("/api/v1/cart/items").set(customerHeaders()).send({
      variantId: ctx.stockedVariantId,
      quantity: 99,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
  });
});
