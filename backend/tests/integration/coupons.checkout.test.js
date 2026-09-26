import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * End-to-end checkout coupon slice against live MySQL (supertest):
 * category → product+variant → inventory → coupon → customer register →
 * address → cart → validate → order → usage/history assertions.
 *
 * Test data uses a unique TSTCK prefix. Products/categories are
 * DEACTIVATED afterwards (no hard-delete endpoints by design); coupons
 * are removed via prisma (orders never reference them, so history is
 * unaffected). The throwaway customer, their cart rows, and the 2 placed
 * orders intentionally persist — orders are immutable by design and the
 * suite documents this instead of faking deletions.
 */

const RUN = `TSTCK${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  customerToken: null,
  addressId: null,
  variantId: null,
  productId: null,
  categoryId: null,
  couponId: null,
  couponCode: `${RUN}SAVE10`,
  firstOrderId: null,
};

async function registerCustomer() {
  const email = `${RUN.toLowerCase()}@example.test`;
  const registered = await request(app)
    .post("/api/v1/auth/register")
    .send({ email, password: "TestPass123!", firstName: "Coupon", lastName: "Tester" });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  expect(loggedIn.body.data.accessToken).toBeTruthy();
  ctx.customerToken = loggedIn.body.data.accessToken;
}

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });

async function addCartItems(quantity) {
  const res = await request(app)
    .post("/api/v1/cart/items")
    .set(customerHeaders())
    .send({ variantId: ctx.variantId, quantity });
  expect(res.status).toBe(200);
  return res;
}

beforeAll(async () => {
  const category = await request(app)
    .post("/api/v1/categories")
    .set(adminHeaders())
    .send({ name: `${RUN} Category` });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app)
    .post("/api/v1/products")
    .set(adminHeaders())
    .send({
      name: `${RUN} Widget`,
      categoryId: ctx.categoryId,
      variants: [{ sku: `${RUN}-SKU1`, name: "Standard", price: "100.00" }],
    });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  ctx.variantId = product.body.data.product.variants[0].id;

  const inventory = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 50 });
  expect(inventory.status).toBe(201);

  const coupon = await request(app)
    .post("/api/v1/coupons")
    .set(adminHeaders())
    .send({ code: ctx.couponCode, discountType: "PERCENTAGE", discountValue: "10", isActive: true });
  expect(coupon.status).toBe(201);
  ctx.couponId = coupon.body.data.coupon.id;

  await registerCustomer();

  const address = await request(app).post("/api/v1/addresses").set(customerHeaders()).send({
    fullName: "Coupon Tester",
    phone: "9999999999",
    addressLine1: "1 Test Street",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    country: "India",
  });
  expect(address.status).toBe(201);
  ctx.addressId = address.body.data.address.id;

  await addCartItems(2);
}, 60000);

afterAll(async () => {
  // Deactivate catalog rows (soft lifecycle by design); remove test
  // coupons directly (orders hold no coupon reference — totals snapshots
  // stay intact).
  try {
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  try {
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  try {
    await prisma.coupon.deleteMany({ where: { code: { startsWith: RUN } } });
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("POST /coupons/validate (customer preview)", () => {
  it("quotes the authoritative discount for a valid code", async () => {
    const res = await request(app).post("/api/v1/coupons/validate").set(customerHeaders()).send({
      code: ctx.couponCode.toLowerCase(),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.coupon.code).toBe(ctx.couponCode);
    expect(res.body.data.orderSubtotal).toBe("200.00");
    expect(res.body.data.discountAmount).toBe("20.00");
  });

  it("rejects unknown codes and requires authentication", async () => {
    const unknown = await request(app)
      .post("/api/v1/coupons/validate")
      .set(customerHeaders())
      .send({ code: `${RUN}NOPE` });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("COUPON_NOT_FOUND");

    const anonymous = await request(app).post("/api/v1/coupons/validate").send({ code: ctx.couponCode });
    expect(anonymous.status).toBe(401);
  });
});

describe("POST /orders with couponCode (server-authoritative checkout)", () => {
  it("writes the discount snapshot, charges the discounted total, and consumes usage", async () => {
    const res = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
      couponCode: ctx.couponCode,
    });
    expect(res.status).toBe(201);
    const order = res.body.data.order;
    ctx.firstOrderId = order.id;
    expect(order.subtotal).toBe("200.00");
    expect(order.discountTotal).toBe("20.00");
    expect(order.grandTotal).toBe("180.00");
    expect(order.payments[0].amount).toBe("180.00");

    const coupon = await request(app).get(`/api/v1/coupons/${ctx.couponId}`).set(adminHeaders());
    expect(coupon.body.data.coupon.usedCount).toBe(1);
  });

  it("consumes usage exactly once per successful order", async () => {
    await addCartItems(2);
    const res = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
      couponCode: ctx.couponCode,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.order.discountTotal).toBe("20.00");

    const coupon = await request(app).get(`/api/v1/coupons/${ctx.couponId}`).set(adminHeaders());
    expect(coupon.body.data.coupon.usedCount).toBe(2);
  });

  it("rejects an invalid coupon without consuming usage or clearing the cart", async () => {
    await addCartItems(1);
    const res = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
      couponCode: `${RUN}NOPE`,
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("COUPON_NOT_FOUND");

    const coupon = await request(app).get(`/api/v1/coupons/${ctx.couponId}`).set(adminHeaders());
    expect(coupon.body.data.coupon.usedCount).toBe(2);

    const cart = await request(app).get("/api/v1/cart").set(customerHeaders());
    expect(cart.body.data.cart.items.length).toBeGreaterThan(0);
  });

  it("rejects exhausted coupons and never overshoots the limit", async () => {
    const limited = await request(app).post("/api/v1/coupons").set(adminHeaders()).send({
      code: `${RUN}ONCE`,
      discountType: "FIXED",
      discountValue: "5",
      usageLimit: 1,
    });
    expect(limited.status).toBe(201);

    const first = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
      couponCode: `${RUN}ONCE`,
    });
    expect(first.status).toBe(201);

    await addCartItems(1);
    const second = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
      couponCode: `${RUN}ONCE`,
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("COUPON_USAGE_LIMIT_EXCEEDED");

    const coupon = await request(app).get(`/api/v1/coupons/${limited.body.data.coupon.id}`).set(adminHeaders());
    expect(coupon.body.data.coupon.usedCount).toBe(1);
  });

  it("failed orders consume no usage", async () => {
    const before = await request(app).get(`/api/v1/coupons/${ctx.couponId}`).set(adminHeaders());
    const usedBefore = before.body.data.coupon.usedCount;

    const res = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: "00000000-0000-0000-0000-000000000000",
      couponCode: ctx.couponCode,
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_ADDRESS_NOT_FOUND");

    const after = await request(app).get(`/api/v1/coupons/${ctx.couponId}`).set(adminHeaders());
    expect(after.body.data.coupon.usedCount).toBe(usedBefore);
  });

  it("keeps historical order discounts stable when the coupon definition changes", async () => {
    const edited = await request(app).patch(`/api/v1/coupons/${ctx.couponId}`).set(adminHeaders()).send({
      discountValue: "50",
    });
    expect(edited.status).toBe(200);

    const order = await request(app).get(`/api/v1/orders/${ctx.firstOrderId}`).set(customerHeaders());
    expect(order.status).toBe(200);
    expect(order.body.data.order.discountTotal).toBe("20.00");
    expect(order.body.data.order.grandTotal).toBe("180.00");
  });
});
