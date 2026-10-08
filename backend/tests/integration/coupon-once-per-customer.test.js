import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { companyOneAdminId, stampUserCompany } from "../helpers/userFixtures.js";
import couponsRepository from "../../src/modules/coupons/coupons.repository.js";

/**
 * One-time-per-customer coupon rule (live MySQL):
 * the first successful order using a coupon records a (couponId, userId)
 * usage row; any later attempt by the same customer is rejected with
 * 409 COUPON_ALREADY_USED — at quote time and at order time — while other
 * customers and existing global rules are unaffected. The UNIQUE pair is
 * the concurrency guard: simultaneous same-customer orders leave at most
 * one winner.
 */

const RUN = `TSTCU${Date.now().toString(36).toUpperCase()}`;
const COMPANY_ONE_ADMIN_ID = await companyOneAdminId();
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: COMPANY_ONE_ADMIN_ID, roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
  couponId: null,
  couponCode: `${RUN}ONCE10`,
  customerA: null, // { email, token, addressId }
  customerB: null,
  firstOrderId: null,
};

async function registerCustomer(tag, body = {}) {
  const email = `${RUN.toLowerCase()}-${tag}@example.test`;
  const registered = await request(app).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    firstName: tag.replace(/[^A-Za-z]/g, "").slice(0, 20) || "Customer",
    lastName: "Tester",
    phone: "9999999999",
    ...body,
  });
  expect(registered.status).toBe(201);
  await stampUserCompany(registered.body.data.user.id);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  const address = await request(app)
    .post("/api/v1/addresses")
    .set({ Authorization: `Bearer ${loggedIn.body.data.accessToken}` })
    .send({
      fullName: "Coupon Tester",
      phone: "9999999999",
      addressLine1: "1 Test Street",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
    });
  expect(address.status).toBe(201);
  return {
    email,
    token: loggedIn.body.data.accessToken,
    addressId: address.body.data.address.id,
  };
}

const headersFor = (customer) => ({ Authorization: `Bearer ${customer.token}` });

async function addCartItems(customer, quantity) {
  const res = await request(app).post("/api/v1/cart/items").set(headersFor(customer)).send({
    variantId: ctx.variantId,
    quantity,
  });
  expect(res.status).toBe(200);
  return res;
}

async function usageRows(couponId, userEmail) {
  const user = await prisma.user.findFirst({ where: { email: userEmail }, select: { id: true } });
  return prisma.couponUsage.findMany({ where: { couponId, userId: user.id } });
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

  const coupon = await request(app).post("/api/v1/coupons").set(adminHeaders()).send({
    code: ctx.couponCode,
    discountType: "PERCENTAGE",
    discountValue: "10",
    isActive: true,
  });
  expect(coupon.status).toBe(201);
  ctx.couponId = coupon.body.data.coupon.id;

  ctx.customerA = await registerCustomer("alice");
  ctx.customerB = await registerCustomer("bob");
}, 90000);

afterAll(async () => {
  try {
    await request(app).patch(`/api/v1/products/${ctx.productId}`).set(adminHeaders()).send({ isActive: false });
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  try {
    await prisma.coupon.deleteMany({ where: { code: { startsWith: RUN } } });
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("one-time-per-customer coupon use", () => {
  it("allows the first use with the expected discount and persists usage", async () => {
    await addCartItems(ctx.customerA, 2);
    const res = await request(app).post("/api/v1/orders").set(headersFor(ctx.customerA)).send({
      shippingAddressId: ctx.customerA.addressId,
      couponCode: ctx.couponCode,
    });
    expect(res.status).toBe(201);
    const order = res.body.data.order;
    ctx.firstOrderId = order.id;
    expect(order.discountTotal).toBe("20.00");
    expect(order.grandTotal).toBe("180.00");
    expect(order.coupon).toMatchObject({ code: ctx.couponCode });

    const usages = await usageRows(ctx.couponId, ctx.customerA.email);
    expect(usages).toHaveLength(1);
    expect(usages[0].orderId).toBe(order.id);
  });

  it("rejects the quote and the order on second use, with no side effects", async () => {
    await addCartItems(ctx.customerA, 2);

    const quote = await request(app).post("/api/v1/coupons/validate").set(headersFor(ctx.customerA)).send({
      code: ctx.couponCode,
    });
    expect(quote.status).toBe(409);
    expect(quote.body.error.code).toBe("COUPON_ALREADY_USED");
    expect(quote.body.error.message).toMatch(/already used/i);

    const cartBefore = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA));
    const quantityBefore = cartBefore.body.data.cart.totalQuantity;
    const stockBefore = await prisma.inventory.findFirst({ where: { variantId: ctx.variantId } });

    const res = await request(app).post("/api/v1/orders").set(headersFor(ctx.customerA)).send({
      shippingAddressId: ctx.customerA.addressId,
      couponCode: ctx.couponCode,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("COUPON_ALREADY_USED");
    expect(res.body.error.message).toMatch(/already used/i);

    // No second usage row, no second order, no inventory consumed, cart kept.
    expect(await usageRows(ctx.couponId, ctx.customerA.email)).toHaveLength(1);
    const stockAfter = await prisma.inventory.findFirst({ where: { variantId: ctx.variantId } });
    expect(Number(stockAfter.quantity)).toBe(Number(stockBefore.quantity));
    const cartAfter = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA));
    expect(cartAfter.body.data.cart.totalQuantity).toBe(quantityBefore);
  });

  it("still allows a different customer to use the same coupon", async () => {
    await addCartItems(ctx.customerB, 2);
    const res = await request(app).post("/api/v1/orders").set(headersFor(ctx.customerB)).send({
      shippingAddressId: ctx.customerB.addressId,
      couponCode: ctx.couponCode,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.order.discountTotal).toBe("20.00");
    expect(await usageRows(ctx.couponId, ctx.customerB.email)).toHaveLength(1);
  });

  it("does not consume usage on failed orders, keeping the coupon usable", async () => {
    // Customer B already used the coupon — use a fresh customer for the
    // failed-then-success sequence.
    const customer = await registerCustomer("carol");
    await addCartItems(customer, 1);

    const failed = await request(app).post("/api/v1/orders").set(headersFor(customer)).send({
      shippingAddressId: "00000000-0000-0000-0000-000000000000",
      couponCode: ctx.couponCode,
    });
    expect(failed.status).toBe(404);

    // Quote still allowed: nothing was consumed by the failure.
    const quote = await request(app).post("/api/v1/coupons/validate").set(headersFor(customer)).send({
      code: ctx.couponCode,
    });
    expect(quote.status).toBe(200);

    const res = await request(app).post("/api/v1/orders").set(headersFor(customer)).send({
      shippingAddressId: customer.addressId,
      couponCode: ctx.couponCode,
    });
    expect(res.status).toBe(201);
    expect(await usageRows(ctx.couponId, customer.email)).toHaveLength(1);
  });

  it("keeps the coupon consumed after the order is cancelled (no restoration semantics)", async () => {
    const cancelled = await request(app)
      .post(`/api/v1/orders/${ctx.firstOrderId}/cancel`)
      .set(headersFor(ctx.customerA));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.order.status).toBe("CANCELLED");

    const res = await request(app).post("/api/v1/orders").set(headersFor(ctx.customerA)).send({
      shippingAddressId: ctx.customerA.addressId,
      couponCode: ctx.couponCode,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("COUPON_ALREADY_USED");
  });

  it("preserves the global usage limit alongside the per-customer rule", async () => {
    const limited = await request(app).post("/api/v1/coupons").set(adminHeaders()).send({
      code: `${RUN}LIMIT1`,
      discountType: "FIXED",
      discountValue: "5",
      usageLimit: 1,
    });
    expect(limited.status).toBe(201);
    const limitedId = limited.body.data.coupon.id;

    const customer = await registerCustomer("dave");
    await addCartItems(customer, 1);
    const first = await request(app).post("/api/v1/orders").set(headersFor(customer)).send({
      shippingAddressId: customer.addressId,
      couponCode: `${RUN}LIMIT1`,
    });
    expect(first.status).toBe(201);

    await addCartItems(ctx.customerB, 1);
    const second = await request(app).post("/api/v1/orders").set(headersFor(ctx.customerB)).send({
      shippingAddressId: ctx.customerB.addressId,
      couponCode: `${RUN}LIMIT1`,
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("COUPON_USAGE_LIMIT_EXCEEDED");
    expect(await usageRows(limitedId, ctx.customerB.email)).toHaveLength(0);
  });

  it("maps pair conflicts to already-used at the ledger layer", async () => {
    const customer = await registerCustomer("erin");
    // Two coupon-free orders give two legitimate order ids to ledger against.
    await addCartItems(customer, 1);
    const first = await request(app).post("/api/v1/orders").set(headersFor(customer)).send({
      shippingAddressId: customer.addressId,
    });
    expect(first.status).toBe(201);
    await addCartItems(customer, 1);
    const second = await request(app).post("/api/v1/orders").set(headersFor(customer)).send({
      shippingAddressId: customer.addressId,
    });
    expect(second.status).toBe(201);

    const me = await prisma.user.findFirst({ where: { email: customer.email }, select: { id: true } });
    const firstWrite = await couponsRepository.recordUsageTx(prisma, {
      couponId: ctx.couponId,
      userId: me.id,
      orderId: first.body.data.order.id,
    });
    expect(firstWrite.outcome).toBe("ok");
    // Same pair, different order: the UNIQUE guard reports already-used
    // (the order-transaction maps this to 409 COUPON_ALREADY_USED).
    const conflict = await couponsRepository.recordUsageTx(prisma, {
      couponId: ctx.couponId,
      userId: me.id,
      orderId: second.body.data.order.id,
    });
    expect(conflict.outcome).toBe("already-used");
  });

  it("leaves at most one order/usage under concurrent same-customer attempts", async () => {
    const customer = await registerCustomer("frank");
    // Stock both attempts from one cart fill.
    await addCartItems(customer, 1);
    await addCartItems(customer, 1);
    const usedBefore = (
      await request(app).get(`/api/v1/coupons/${ctx.couponId}`).set(adminHeaders())
    ).body.data.coupon.usedCount;

    const attempts = await Promise.all([
      request(app).post("/api/v1/orders").set(headersFor(customer)).send({
        shippingAddressId: customer.addressId,
        couponCode: ctx.couponCode,
      }),
      request(app).post("/api/v1/orders").set(headersFor(customer)).send({
        shippingAddressId: customer.addressId,
        couponCode: ctx.couponCode,
      }),
    ]);
    const succeeded = attempts.filter((r) => r.status === 201);
    const rejected = attempts.filter((r) => r.status !== 201);
    // Exactly one winner regardless of interleaving: the loser is either
    // rejected by the pair guard (both read a full cart) or finds the cart
    // already cleared by the winner — both preserve the invariant.
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(["COUPON_ALREADY_USED", "ORDER_EMPTY_CART"]).toContain(rejected[0].body.error.code);
    expect(await usageRows(ctx.couponId, customer.email)).toHaveLength(1);
    const usedAfter = (
      await request(app).get(`/api/v1/coupons/${ctx.couponId}`).set(adminHeaders())
    ).body.data.coupon.usedCount;
    expect(usedAfter).toBe(usedBefore + 1);
  });
});
