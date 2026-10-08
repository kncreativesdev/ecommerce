import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-6 review + coupon tenant isolation (live HTTP + MySQL).
 *
 * Dedicated companies A, B, and S(uspended) with provisioned admins,
 * stamped customers, per-company catalog, delivered orders, and reviews
 * + coupons created through the real APIs (which also proves creator
 * stamping). Cross-company ids fail exactly like unknown ids.
 *
 * No admin review detail/moderation endpoints exist (read-only list by
 * design) and no direct CouponUsage read endpoint exists — those cases
 * are N/A by construction and documented, not tested. The dangling-
 * company branch is FK-unreachable over HTTP and stays covered by
 * tests/unit/company-context.test.js.
 *
 * Cleanup follows repo convention: cart lines removed, catalog
 * deactivated; orders/reviews/coupons/users/companies persist as
 * ordinary rows.
 */

const RUN = `TSTRC${Date.now().toString(36).toUpperCase()}`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles = ["CUSTOMER"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN.toLowerCase()}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "RcIso",
      lastName: tag,
      phone: "9999999999",
      companyId,
    },
  });
  createdUserIds.push(user.id);
  let role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    role = await prisma.role.create({ data: { name: roleName } });
  }
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function createCatalog(tag, companyId) {
  const category = await prisma.category.create({
    data: { name: `${RUN} Cat ${tag}`, slug: `${RUN.toLowerCase()}-cat-${tag}`, companyId },
  });
  const product = await prisma.product.create({
    data: {
      name: `${RUN} Doohickey ${tag}`,
      slug: `${RUN.toLowerCase()}-prod-${tag}`,
      categoryId: category.id,
      companyId,
      isActive: true,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `${RUN}-${tag}`,
      name: `Variant ${tag}`,
      price: "120.00",
      isActive: true,
      companyId,
    },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, quantity: 30, reservedQuantity: 0 } });
  return { category, product, variant };
}

async function placeDeliveredOrder(customerId, adminId, variantId, addressId) {
  await request(app).post("/api/v1/cart/items").set(headersFor(customerId)).send({
    variantId,
    quantity: 1,
  }).expect(200);
  const order = await request(app).post("/api/v1/orders").set(headersFor(customerId)).send({
    shippingAddressId: addressId,
  });
  expect(order.status).toBe(201);
  const orderId = order.body.data.order.id;
  for (const status of ["CONFIRMED", "PROCESSING", "DISPATCHED", "IN_TRANSIT", "ARRIVED_IN_CITY", "OUT_FOR_DELIVERY", "DELIVERED"]) {
    const step = await request(app)
      .patch(`/api/v1/orders/admin/${orderId}/status`)
      .set(headersFor(adminId, ["ADMIN"]))
      .send({ status });
    expect(step.status).toBe(200);
  }
  const item = await prisma.orderItem.findFirst({ where: { orderId }, select: { id: true } });
  return { orderId, orderItemId: item.id };
}

beforeAll(async () => {
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN.toLowerCase()}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "RcIso",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = admin;
  }
  ctx.catA = await createCatalog("a", ctx.companyA.id);
  ctx.catB = await createCatalog("b", ctx.companyB.id);
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.customerB = await createUser("customer-b", "CUSTOMER", ctx.companyB.id);
  ctx.loner = await createUser("loner", "CUSTOMER", null);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);

  for (const [tag, customerId] of [["A", ctx.customerA.id], ["B", ctx.customerB.id]]) {
    const address = await request(app)
      .post("/api/v1/addresses")
      .set(headersFor(customerId))
      .send({
        fullName: "Rc Iso",
        phone: "9999999999",
        addressLine1: "5 Isolation Road",
        city: "Ludhiana",
        state: "Punjab",
        postalCode: "141002",
        country: "India",
      });
    expect(address.status).toBe(201);
    ctx[`address${tag}`] = address.body.data.address.id;
  }

  const boughtA = await placeDeliveredOrder(ctx.customerA.id, ctx.adminA.id, ctx.catA.variant.id, ctx.addressA);
  ctx.orderItemA = boughtA.orderItemId;
  const boughtB = await placeDeliveredOrder(ctx.customerB.id, ctx.adminB.id, ctx.catB.variant.id, ctx.addressB);
  ctx.orderItemB = boughtB.orderItemId;

  for (const [tag, customerId, orderItemId] of [["A", ctx.customerA.id, ctx.orderItemA], ["B", ctx.customerB.id, ctx.orderItemB]]) {
    const review = await request(app)
      .post("/api/v1/reviews")
      .set(headersFor(customerId))
      .send({ orderItemId, rating: 5, title: `Superb ${tag}`, comment: `Loved it ${tag}` });
    expect(review.status).toBe(201);
    ctx[`review${tag}`] = review.body.data.review;
  }

  for (const [tag, adminId] of [["A", ctx.adminA.id], ["B", ctx.adminB.id]]) {
    const coupon = await request(app)
      .post("/api/v1/coupons")
      .set(headersFor(adminId, ["ADMIN"]))
      .send({ code: `${RUN}-${tag}10`, discountType: "FIXED", discountValue: "10.00" });
    expect(coupon.status).toBe(201);
    ctx[`coupon${tag}`] = coupon.body.data.coupon;
  }
}, 180000);

afterAll(async () => {
  await prisma.cartItem.deleteMany({
    where: { cart: { userId: { in: [ctx.customerA?.id, ctx.customerB?.id].filter(Boolean) } } },
  });
  for (const cat of [ctx.catA, ctx.catB].filter(Boolean)) {
    await prisma.productVariant.updateMany({ where: { productId: cat.product.id }, data: { isActive: false } });
    await prisma.product.updateMany({ where: { id: cat.product.id }, data: { isActive: false } });
    await prisma.category.updateMany({ where: { id: cat.category.id }, data: { isActive: false } });
  }
  await prisma.$disconnect();
});

const adminA = () => headersFor(ctx.adminA.id, ["ADMIN"]);
const adminB = () => headersFor(ctx.adminB.id, ["ADMIN"]);

describe("review isolation", () => {
  it("A admin lists only Company A reviews", async () => {
    const res = await request(app).get("/api/v1/reviews/admin").set(adminA());
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data.reviews[0].id).toBe(ctx.reviewA.id);
  });

  it("no admin review mutation endpoint exists to abuse", async () => {
    const patch = await request(app)
      .patch(`/api/v1/reviews/admin/${ctx.reviewB.id}`)
      .set(adminA())
      .send({ rating: 1 });
    expect(patch.status).toBe(404);
    const reread = await prisma.review.findUnique({ where: { id: ctx.reviewB.id } });
    expect(reread.rating).toBe(5);
  });

  it("customer A cannot mutate B's review", async () => {
    const patch = await request(app)
      .patch(`/api/v1/reviews/${ctx.reviewB.id}`)
      .set(headersFor(ctx.customerA.id))
      .send({ rating: 1 });
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe("REVIEW_NOT_FOUND");
    const del = await request(app)
      .delete(`/api/v1/reviews/${ctx.reviewB.id}`)
      .set(headersFor(ctx.customerA.id));
    expect(del.status).toBe(404);
    expect((await prisma.review.findUnique({ where: { id: ctx.reviewB.id } })).rating).toBe(5);
  });

  it("customer A cannot review B's purchased item", async () => {
    const res = await request(app)
      .post("/api/v1/reviews")
      .set(headersFor(ctx.customerA.id))
      .send({ orderItemId: ctx.orderItemB, rating: 4 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("REVIEW_ORDER_ITEM_NOT_FOUND");
  });

  it("public product reviews never mix companies", async () => {
    // Phase 2C-12: each product's reviews resolve through its own
    // domain; unregistered hosts fail closed (covered in the
    // storefront suite — here both domains stay registered).
    const hostA = `reviews-${RUN.toLowerCase()}-a.example.test`;
    const hostB = `reviews-${RUN.toLowerCase()}-b.example.test`;
    await prisma.companyDomain.createMany({
      data: [
        { companyId: ctx.companyA.id, domain: hostA },
        { companyId: ctx.companyB.id, domain: hostB },
      ],
    });
    try {
      const listA = await request(app).get(`/api/v1/reviews/product/${ctx.catA.product.id}`).set("Host", hostA);
      expect(listA.status).toBe(200);
      expect(listA.body.data.map((r) => r.id)).toContain(ctx.reviewA.id);
      expect(listA.body.data.map((r) => r.id)).not.toContain(ctx.reviewB.id);
      const listB = await request(app).get(`/api/v1/reviews/product/${ctx.catB.product.id}`).set("Host", hostB);
      expect(listB.status).toBe(200);
      expect(listB.body.data.map((r) => r.id)).toContain(ctx.reviewB.id);
      expect(listB.body.data.map((r) => r.id)).not.toContain(ctx.reviewA.id);
    } finally {
      await prisma.companyDomain.deleteMany({ where: { domain: { in: [hostA, hostB] } } });
    }
  });
});

describe("coupon isolation", () => {
  it("A admin list excludes B coupons; B coupon detail/mutations 404", async () => {
    const list = await request(app).get("/api/v1/coupons").set(adminA());
    expect(list.status).toBe(200);
    expect(list.body.data.coupons.map((c) => c.id)).toContain(ctx.couponA.id);
    expect(list.body.data.coupons.map((c) => c.id)).not.toContain(ctx.couponB.id);
    const detail = await request(app).get(`/api/v1/coupons/${ctx.couponB.id}`).set(adminA());
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe("COUPON_NOT_FOUND");
    expect(JSON.stringify(detail.body)).not.toContain(ctx.couponB.code);
    const patch = await request(app)
      .patch(`/api/v1/coupons/${ctx.couponB.id}`)
      .set(adminA())
      .send({ description: "Hijacked" });
    expect(patch.status).toBe(404);
    const deactivate = await request(app)
      .patch(`/api/v1/coupons/${ctx.couponB.id}`)
      .set(adminA())
      .send({ isActive: false });
    expect(deactivate.status).toBe(404);
    const del = await request(app).delete(`/api/v1/coupons/${ctx.couponB.id}`).set(adminA());
    expect(del.status).toBe(404);
    const reread = await prisma.coupon.findUnique({ where: { id: ctx.couponB.id } });
    expect(reread.isActive).toBe(true);
  });

  it("A creates stamped coupons; B-product restriction is rejected", async () => {
    const stored = await prisma.coupon.findUnique({ where: { id: ctx.couponA.id } });
    expect(stored.companyId).toBe(ctx.companyA.id);
    const res = await request(app)
      .post("/api/v1/coupons")
      .set(adminA())
      .send({
        code: `${RUN}-AX`,
        discountType: "FIXED",
        discountValue: "5.00",
        productIds: [ctx.catB.product.id],
      });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("A customer cannot validate or redeem B's coupon", async () => {
    await request(app).post("/api/v1/cart/items").set(headersFor(ctx.customerA.id)).send({
      variantId: ctx.catA.variant.id,
      quantity: 1,
    }).expect(200);
    const quote = await request(app)
      .post("/api/v1/coupons/validate")
      .set(headersFor(ctx.customerA.id))
      .send({ code: ctx.couponB.code });
    expect(quote.status).toBe(404);
    expect(quote.body.error.code).toBe("COUPON_NOT_FOUND");
    const unknown = await request(app)
      .post("/api/v1/coupons/validate")
      .set(headersFor(ctx.customerA.id))
      .send({ code: `NOPE-${randomUUID().slice(0, 8).toUpperCase()}` });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("COUPON_NOT_FOUND");
    const ordersBefore = await prisma.order.count({ where: { userId: ctx.customerA.id } });
    const checkout = await request(app).post("/api/v1/orders").set(headersFor(ctx.customerA.id)).send({
      shippingAddressId: ctx.addressA,
      couponCode: ctx.couponB.code,
    });
    expect(checkout.status).toBe(404);
    expect(checkout.body.error.code).toBe("COUPON_NOT_FOUND");
    expect(await prisma.order.count({ where: { userId: ctx.customerA.id } })).toBe(ordersBefore);
    expect(await prisma.couponUsage.count({ where: { couponId: ctx.couponB.id } })).toBe(0);
    const cart = await prisma.cart.findUnique({
      where: { userId: ctx.customerA.id },
      select: { items: { select: { id: true } } },
    });
    await prisma.cartItem.deleteMany({ where: { id: { in: cart.items.map((i) => i.id) } } });
  });

  it("one-time usage still works within the company", async () => {
    await request(app).post("/api/v1/cart/items").set(headersFor(ctx.customerA.id)).send({
      variantId: ctx.catA.variant.id,
      quantity: 1,
    }).expect(200);
    const first = await request(app).post("/api/v1/orders").set(headersFor(ctx.customerA.id)).send({
      shippingAddressId: ctx.addressA,
      couponCode: ctx.couponA.code,
    });
    expect(first.status).toBe(201);
    expect(
      await prisma.couponUsage.count({ where: { couponId: ctx.couponA.id, userId: ctx.customerA.id } })
    ).toBe(1);
    await request(app).post("/api/v1/cart/items").set(headersFor(ctx.customerA.id)).send({
      variantId: ctx.catA.variant.id,
      quantity: 1,
    }).expect(200);
    const second = await request(app).post("/api/v1/orders").set(headersFor(ctx.customerA.id)).send({
      shippingAddressId: ctx.addressA,
      couponCode: ctx.couponA.code,
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("COUPON_ALREADY_USED");
  });

  it("history stays with its own coupon", async () => {
    const cross = await request(app).get(`/api/v1/coupons/${ctx.couponB.id}/history`).set(adminA());
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe("COUPON_NOT_FOUND");
    const own = await request(app).get(`/api/v1/coupons/${ctx.couponA.id}/history`).set(adminA());
    expect(own.status).toBe(200);
    expect(own.body.data.history.map((h) => h.action)).toContain("CREATED");
    expect(own.body.data.history.every((h) => h.couponId === ctx.couponA.id)).toBe(true);
  });
});

describe("context, platform, suspension, overrides", () => {
  it("company-less callers fail closed on mounted review/coupon routes", async () => {
    const review = await request(app)
      .post("/api/v1/reviews")
      .set(headersFor(ctx.loner.id))
      .send({ orderItemId: ctx.orderItemA, rating: 3 });
    expect(review.status).toBe(403);
    expect(review.body.error.code).toBe("AUTH_COMPANY_REQUIRED");
    const validate = await request(app)
      .post("/api/v1/coupons/validate")
      .set(headersFor(ctx.loner.id))
      .send({ code: ctx.couponA.code });
    expect(validate.status).toBe(403);
  });

  it("SUPER_ADMIN cannot operate company reviews or coupons", async () => {
    const headers = headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
    for (const res of [
      await request(app).get("/api/v1/reviews/admin").set(headers),
      await request(app).get("/api/v1/coupons").set(headers),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    }
  });

  it("client companyId cannot bypass either module", async () => {
    const strict = await request(app)
      .post("/api/v1/coupons")
      .set(adminA())
      .send({
        code: `${RUN}-SMUGGLED`,
        discountType: "FIXED",
        discountValue: "1.00",
        companyId: ctx.companyB.id,
      });
    expect(strict.status).toBe(422);
    const ignored = await request(app)
      .get("/api/v1/coupons")
      .query({ companyId: ctx.companyB.id })
      .set({ ...adminA(), "x-company-id": ctx.companyB.id });
    expect(ignored.status).toBe(200);
    expect(ignored.body.data.coupons.map((c) => c.id)).not.toContain(ctx.couponB.id);
  });

  it("suspended company admin is rejected without creating data (Phase 2C-13)", async () => {
    const code = `${RUN}-S1`;
    const res = await request(app)
      .post("/api/v1/coupons")
      .set(headersFor(ctx.adminS.id, ["ADMIN"]))
      .send({ code, discountType: "FIXED", discountValue: "2.00" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
    expect(await prisma.coupon.findUnique({ where: { code } })).toBeNull();
  });
});
