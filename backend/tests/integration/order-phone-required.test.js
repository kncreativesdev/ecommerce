import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Phone-required order booking (live MySQL):
 * POST /api/v1/orders rejects customers whose profile (User.phone) has no
 * usable phone number — before any order/inventory side effects. The phone
 * comes from the authenticated profile, never the request body (strict
 * ids-only DTO) and never another customer's record. Address snapshots
 * keep working exactly as before.
 */

const RUN = `TSTOP${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
  addressId: null,
  customerToken: null,
  customerEmail: null,
  otherToken: null,
  otherAddressId: null,
};

async function registerCustomer(tag, body = {}) {
  const email = `${RUN.toLowerCase()}-${tag}@example.test`;
  const registered = await request(app).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    firstName: tag.replace(/[^A-Za-z]/g, "").slice(0, 20) || "Customer",
    lastName: "Tester",
    ...body,
  });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  return { email, token: loggedIn.body.data.accessToken, id: registered.body.data.user.id };
}

async function createAddress(token, overrides = {}) {
  const res = await request(app).post("/api/v1/addresses").set({ Authorization: `Bearer ${token}` }).send({
    fullName: "Phone Tester",
    phone: "9999999999",
    addressLine1: "1 Test Street",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    country: "India",
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body.data.address;
}

async function addToCart(token, quantity = 1) {
  const res = await request(app).post("/api/v1/cart/items").set({ Authorization: `Bearer ${token}` }).send({
    variantId: ctx.variantId,
    quantity,
  });
  expect(res.status).toBe(200);
  return res;
}

async function cartCount(token) {
  const res = await request(app).get("/api/v1/cart").set({ Authorization: `Bearer ${token}` });
  expect(res.status).toBe(200);
  return res.body.data.cart.totalQuantity;
}

async function inventoryAvailable() {
  const row = await prisma.inventory.findFirst({ where: { variantId: ctx.variantId } });
  return Number(row.quantity ?? 0) - Number(row.reservedQuantity ?? 0);
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
    .send({ quantity: 50 });
  expect(inv.status).toBe(201);

  // Primary customer: no profile phone. Second customer: has one.
  const primary = await registerCustomer("nophone");
  ctx.customerToken = primary.token;
  ctx.customerEmail = primary.email;
  ctx.customerId = primary.id;
  const other = await registerCustomer("hasphone", { phone: "9876543210" });
  ctx.otherToken = other.token;

  ctx.address = await createAddress(ctx.customerToken);
  ctx.addressId = ctx.address.id;
  const otherAddress = await createAddress(ctx.otherToken);
  ctx.otherAddressId = otherAddress.id;

  await addToCart(ctx.customerToken, 1);
}, 90000);

afterAll(async () => {
  try {
    await request(app).patch(`/api/v1/products/${ctx.productId}`).set(adminHeaders()).send({ isActive: false });
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });

describe("order phone requirement", () => {
  it("rejects a customer with no profile phone", async () => {
    const res = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ORDER_PHONE_REQUIRED");
  });

  it("rejects empty and whitespace-only stored phones", async () => {
    for (const phone of ["", "   "]) {
      await prisma.user.update({ where: { id: ctx.customerId }, data: { phone } });
      const res = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
        shippingAddressId: ctx.addressId,
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_PHONE_REQUIRED");
    }
    await prisma.user.update({ where: { id: ctx.customerId }, data: { phone: null } });
  });

  it("rejects before order/inventory side effects", async () => {
    const cartBefore = await cartCount(ctx.customerToken);
    expect(cartBefore).toBeGreaterThan(0);
    const stockBefore = await inventoryAvailable();

    const res = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
    });
    expect(res.status).toBe(422);

    // Cart untouched, inventory untouched, no order created.
    expect(await cartCount(ctx.customerToken)).toBe(cartBefore);
    expect(await inventoryAvailable()).toBe(stockBefore);
    const orders = await request(app).get("/api/v1/orders").set(customerHeaders());
    expect(orders.status).toBe(200);
    expect(orders.body.data).toHaveLength(0);
  });

  it("ignores a phone smuggled in the request body (strict DTO)", async () => {
    const res = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
      phone: "9999999999",
    });
    // Unknown field rejected by the strict schema — never trusted.
    expect(res.status).toBe(422);
  });

  it("keeps address ownership enforced", async () => {
    const res = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.otherAddressId,
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_ADDRESS_NOT_FOUND");
  });

  it("allows the order once the profile phone is set, with the address snapshot intact", async () => {
    const patched = await request(app).patch("/api/v1/users/me").set(customerHeaders()).send({
      phone: " 9999999999 ",
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.user.phone).toBe("9999999999");

    const res = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
    });
    expect(res.status).toBe(201);
    const order = res.body.data.order;
    const shipping = order.addresses.find((a) => a.type === "SHIPPING");
    // Snapshot comes from the shipping address, as before.
    expect(shipping).toMatchObject({ phone: "9999999999", addressLine1: "1 Test Street" });

    // Clearing the profile phone blocks the next order again.
    await addToCart(ctx.customerToken, 1);
    const cleared = await request(app).patch("/api/v1/users/me").set(customerHeaders()).send({ phone: null });
    expect(cleared.status).toBe(200);
    const again = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
    });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe("ORDER_PHONE_REQUIRED");
  });

  it("lets customers who already have a phone order normally", async () => {
    await addToCart(ctx.otherToken, 1);
    const res = await request(app)
      .post("/api/v1/orders")
      .set({ Authorization: `Bearer ${ctx.otherToken}` })
      .send({ shippingAddressId: ctx.otherAddressId });
    expect(res.status).toBe(201);
    expect(res.body.data.order.status).toBe("PENDING");
  });
});
