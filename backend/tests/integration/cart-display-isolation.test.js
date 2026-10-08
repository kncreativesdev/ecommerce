import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-8 cart-display isolation (live HTTP + MySQL).
 *
 * Mutation paths were closed in Phase 2C-1, but cart READS rendered
 * whatever lines existed — a contaminated line (pre-enforcement
 * legacy, direct writes, null-company catalog) would display foreign
 * product/variant/image/price/stock data. Reads now fail closed via
 * the same company gate instead of returning mixed-company carts.
 *
 * There is no clear/count/summary endpoint (only get/add/update/
 * remove — verified by route inspection), no coupon state in cart
 * responses, no category object in cart responses, and update takes
 * quantity only (variant reassignment is impossible by schema).
 *
 * Cleanup: cart lines removed, catalog deactivated.
 */

const RUN = `TSTCD${Date.now().toString(36).toUpperCase()}`;

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
      firstName: "CartDsp",
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

async function createCatalog(tag, companyId, price = "80.00", quantity = 10) {
  const category = await prisma.category.create({
    data: { name: `${RUN} Cat ${tag}`, slug: `${RUN.toLowerCase()}-cat-${tag}`, companyId },
  });
  const product = await prisma.product.create({
    data: {
      name: `${RUN} Gadget ${tag}`,
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
      price,
      isActive: true,
      companyId,
    },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, quantity, reservedQuantity: 0 } });
  return { category, product, variant };
}

beforeAll(async () => {
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN.toLowerCase()}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "CartDsp",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = admin;
  }
  ctx.catA = await createCatalog("a", ctx.companyA.id, "80.00", 10);
  ctx.catB = await createCatalog("b", ctx.companyB.id, "200.00", 10);
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.customerB = await createUser("customer-b", "CUSTOMER", ctx.companyB.id);
  ctx.customerS = await createUser("customer-s", "CUSTOMER", ctx.companyS.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);

  const coupon = await request(app)
    .post("/api/v1/coupons")
    .set(headersFor(ctx.adminA.id, ["ADMIN"]))
    .send({ code: `${RUN}-A5`, discountType: "FIXED", discountValue: "5.00" });
  expect(coupon.status).toBe(201);

  await request(app).post("/api/v1/cart/items").set(headersFor(ctx.customerA.id)).send({
    variantId: ctx.catA.variant.id,
    quantity: 2,
  }).expect(200);
  await request(app).post("/api/v1/cart/items").set(headersFor(ctx.customerB.id)).send({
    variantId: ctx.catB.variant.id,
    quantity: 1,
  }).expect(200);
}, 120000);

afterAll(async () => {
  await prisma.cartItem.deleteMany({
    where: {
      cart: { userId: { in: [ctx.customerA?.id, ctx.customerB?.id, ctx.customerS?.id].filter(Boolean) } },
    },
  });
  for (const cat of [ctx.catA, ctx.catB].filter(Boolean)) {
    await prisma.productVariant.updateMany({ where: { productId: cat.product.id }, data: { isActive: false } });
    await prisma.product.updateMany({ where: { id: cat.product.id }, data: { isActive: false } });
    await prisma.category.updateMany({ where: { id: cat.category.id }, data: { isActive: false } });
  }
  await prisma.$disconnect();
});

async function cartOf(userId) {
  return prisma.cart.findUnique({
    where: { userId },
    select: { id: true, items: { select: { id: true, variantId: true } } },
  });
}

describe("cart ownership", () => {
  it("A reads only its own cart", async () => {
    const res = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA.id));
    expect(res.status).toBe(200);
    expect(res.body.data.cart.items.map((i) => i.variantId)).toContain(ctx.catA.variant.id);
    expect(res.body.data.cart.items.map((i) => i.variantId)).not.toContain(ctx.catB.variant.id);
  });

  it("A cannot mutate B's cart lines; own removal works", async () => {
    const cartB = await cartOf(ctx.customerB.id);
    const foreignItem = cartB.items[0].id;
    const patch = await request(app)
      .patch(`/api/v1/cart/items/${foreignItem}`)
      .set(headersFor(ctx.customerA.id))
      .send({ quantity: 9 });
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe("CART_ITEM_NOT_FOUND");
    const del = await request(app)
      .delete(`/api/v1/cart/items/${foreignItem}`)
      .set(headersFor(ctx.customerA.id));
    expect(del.status).toBe(404);
    // Positive control: own lines remain fully manageable.
    const own = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA.id));
    const ownItem = own.body.data.cart.items[0].id;
    const update = await request(app)
      .patch(`/api/v1/cart/items/${ownItem}`)
      .set(headersFor(ctx.customerA.id))
      .send({ quantity: 3 });
    expect(update.status).toBe(200);
    const remove = await request(app)
      .delete(`/api/v1/cart/items/${ownItem}`)
      .set(headersFor(ctx.customerA.id));
    expect(remove.status).toBe(200);
    expect(remove.body.data.cart.items).toHaveLength(0);
    // Restore the A line for later display assertions.
    await request(app).post("/api/v1/cart/items").set(headersFor(ctx.customerA.id)).send({
      variantId: ctx.catA.variant.id,
      quantity: 2,
    }).expect(200);
  });

  it("query/header companyId cannot override cart ownership", async () => {
    const res = await request(app)
      .get("/api/v1/cart")
      .query({ companyId: ctx.companyB.id })
      .set({ ...headersFor(ctx.customerA.id), "x-company-id": ctx.companyB.id });
    expect(res.status).toBe(200);
    expect(res.body.data.cart.items.map((i) => i.variantId)).toContain(ctx.catA.variant.id);
  });
});

describe("catalog isolation on write paths", () => {
  it("A cannot add B's variant (identical to unknown ids)", async () => {
    const cross = await request(app)
      .post("/api/v1/cart/items")
      .set(headersFor(ctx.customerA.id))
      .send({ variantId: ctx.catB.variant.id, quantity: 1 });
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
    const unknown = await request(app)
      .post("/api/v1/cart/items")
      .set(headersFor(ctx.customerA.id))
      .send({ variantId: randomUUID(), quantity: 1 });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
  });

  it("update cannot retarget a line onto another variant", async () => {
    const own = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA.id));
    const ownItem = own.body.data.cart.items[0].id;
    // Quantity is the only updatable field: variantId is not accepted.
    const res = await request(app)
      .patch(`/api/v1/cart/items/${ownItem}`)
      .set(headersFor(ctx.customerA.id))
      .send({ quantity: 2, variantId: ctx.catB.variant.id });
    expect(res.status).toBe(422);
    const reread = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA.id));
    expect(reread.body.data.cart.items.map((i) => i.variantId)).not.toContain(ctx.catB.variant.id);
  });
});

describe("display isolation and fail-closed reads", () => {
  it("contaminated carts fail closed instead of rendering foreign data", async () => {
    const cart = await cartOf(ctx.customerA.id);
    const planted = await prisma.cartItem.create({
      data: { cartId: cart.id, variantId: ctx.catB.variant.id, quantity: 1 },
    });
    const res = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA.id));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
    await prisma.cartItem.delete({ where: { id: planted.id } });
    const recovered = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA.id));
    expect(recovered.status).toBe(200);
  });

  it("companyless catalog rows are rejected at the database boundary", async () => {
    // Phase 2C-10 hardened ProductVariant.companyId to NOT NULL, so a
    // null-company variant can no longer exist to contaminate a cart:
    // the database itself refuses the write. The read gate above still
    // covers cross-company lines.
    await expect(
      prisma.productVariant.create({
        data: {
          productId: ctx.catA.product.id,
          sku: `${RUN}-ORPHAN`,
          name: "Orphan",
          price: "10.00",
          isActive: true,
        },
      })
    ).rejects.toThrow();
    expect(
      await prisma.productVariant.findFirst({ where: { sku: `${RUN}-ORPHAN` } })
    ).toBeNull();
  });

  it("clean cart responses contain only own-company data and no internals", async () => {
    const res = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA.id));
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain(ctx.catA.variant.sku);
    expect(body).toContain(ctx.catA.product.slug);
    expect(body).not.toContain(ctx.catB.variant.sku);
    expect(body).not.toContain(ctx.catB.product.slug);
    expect(body).not.toContain("companyId");
    expect(body).not.toContain("reservedQuantity");
    expect(body).not.toContain("coupon");
    expect(body).not.toContain("discount");
    expect(body).not.toContain("category");
    const item = res.body.data.cart.items[0];
    expect(typeof item.inStock).toBe("boolean");
    expect(item.inStock).toBe(true);
  });
});

describe("regression, platform, suspension", () => {
  it("legitimate flows, totals, stock validation, and coupon quotes hold", async () => {
    // Subtotal math on known prices: 2 × 80.00.
    const cart = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA.id));
    expect(cart.body.data.cart.subtotal).toBe("160.00");
    expect(cart.body.data.cart.totalQuantity).toBe(2);
    const over = await request(app)
      .post("/api/v1/cart/items")
      .set(headersFor(ctx.customerA.id))
      .send({ variantId: ctx.catA.variant.id, quantity: 999999 });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("INSUFFICIENT_STOCK");
    const quote = await request(app)
      .post("/api/v1/coupons/validate")
      .set(headersFor(ctx.customerA.id))
      .send({ code: `${RUN}-A5` });
    expect(quote.status).toBe(200);
  });

  it("SUPER_ADMIN has no cart operations", async () => {
    const res = await request(app)
      .get("/api/v1/cart")
      .set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_COMPANY_REQUIRED");
  });

  it("suspended customer cart reads are rejected (Phase 2C-13)", async () => {
    const res = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerS.id));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
  });
});
