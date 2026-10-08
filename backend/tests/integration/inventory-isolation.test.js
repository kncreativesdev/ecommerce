import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-3 inventory tenant isolation (live HTTP + MySQL).
 *
 * Dedicated companies A, B, and S(uspended) each own catalog +
 * inventory rows. All inventory addressing is variant/product-scoped
 * (no inventory-ID or bulk-mutation endpoint exists — verified by
 * route inspection, so those cases are N/A by construction and
 * documented, not tested). Cross-company access must 404 exactly like
 * unknown ids, with zero stock or ledger side effects.
 *
 * Cleanup follows repo convention: cart lines removed, catalog rows
 * deactivated (orders/history persist as immutable rows).
 */

const RUN = `TSTII${Date.now().toString(36).toUpperCase()}`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles = ["ADMIN"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});
const nested = (productId, variantId, suffix = "") =>
  `/api/v1/products/${productId}/variants/${variantId}/inventory${suffix}`;

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN.toLowerCase()}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "InvIso",
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

async function createCatalog(tag, companyId, skus) {
  const category = await prisma.category.create({
    data: { name: `${RUN} Cat ${tag}`, slug: `${RUN.toLowerCase()}-cat-${tag}`, companyId },
  });
  const product = await prisma.product.create({
    data: {
      name: `${RUN} Gizmo ${tag}`,
      slug: `${RUN.toLowerCase()}-prod-${tag}`,
      categoryId: category.id,
      companyId,
      isActive: true,
    },
  });
  const variants = {};
  for (const { key, qty, stocked } of skus) {
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${RUN}-${tag}-${key}`,
        name: `Variant ${tag}${key}`,
        price: "50.00",
        isActive: true,
        companyId,
      },
    });
    if (stocked) {
      await prisma.inventory.create({ data: { variantId: variant.id, quantity: qty, reservedQuantity: 0 } });
    }
    variants[key] = variant;
  }
  return { category, product, variants };
}

beforeAll(async () => {
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN.toLowerCase()}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "InvIso",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = admin;
  }
  ctx.catA = await createCatalog("a", ctx.companyA.id, [
    { key: "in", qty: 10, stocked: true },
    { key: "out", qty: 0, stocked: true },
    { key: "bare", qty: 0, stocked: false },
  ]);
  ctx.catB = await createCatalog("b", ctx.companyB.id, [{ key: "in", qty: 7, stocked: true }]);
  ctx.catS = await createCatalog("s", ctx.companyS.id, [{ key: "in", qty: 4, stocked: true }]);
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);
}, 120000);

afterAll(async () => {
  await prisma.cartItem.deleteMany({
    where: { cart: { userId: { in: [ctx.customerA?.id].filter(Boolean) } } },
  });
  for (const cat of [ctx.catA, ctx.catB, ctx.catS].filter(Boolean)) {
    await prisma.productVariant.updateMany({
      where: { productId: cat.product.id },
      data: { isActive: false },
    });
    await prisma.product.updateMany({ where: { id: cat.product.id }, data: { isActive: false } });
    await prisma.category.updateMany({ where: { id: cat.category.id }, data: { isActive: false } });
  }
  await prisma.$disconnect();
});

const adminA = () => headersFor(ctx.adminA.id);
const adminB = () => headersFor(ctx.adminB.id);

describe("inventory list isolation", () => {
  it("A lists only its own stock", async () => {
    const res = await request(app).get("/api/v1/inventory").set(adminA());
    expect(res.status).toBe(200);
    const skus = res.body.data.items.map((i) => i.variant.sku);
    expect(skus).toContain(`${RUN}-a-in`);
    expect(skus).toContain(`${RUN}-a-out`);
    expect(skus.some((s) => s.startsWith(`${RUN}-b-`))).toBe(false);
  });

  it("out-of-stock filter returns only the caller's company rows", async () => {
    const res = await request(app).get("/api/v1/inventory").query({ stock: "out" }).set(adminA());
    expect(res.status).toBe(200);
    const skus = res.body.data.items.map((i) => i.variant.sku);
    // A's zero-stock row is visible; no B sku may appear regardless.
    expect(skus).toContain(`${RUN}-a-out`);
    expect(skus.some((s) => s.startsWith(`${RUN}-b-`))).toBe(false);
  });

  it("search cannot surface the other company's variants", async () => {
    const res = await request(app)
      .get("/api/v1/inventory")
      .query({ search: `${RUN}-b-in` })
      .set(adminA());
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
    expect(res.body.data.items).toHaveLength(0);
  });
});

describe("inventory detail and ledger isolation", () => {
  it("A reads its own detail and ledger", async () => {
    const detail = await request(app)
      .get(nested(ctx.catA.product.id, ctx.catA.variants.in.id))
      .set(adminA());
    expect(detail.status).toBe(200);
    expect(detail.body.data.inventory.quantity).toBe(10);
    const ledger = await request(app)
      .get(nested(ctx.catA.product.id, ctx.catA.variants.in.id, "/transactions"))
      .set(adminA());
    expect(ledger.status).toBe(200);
    expect(Array.isArray(ledger.body.data.transactions)).toBe(true);
  });

  it("A cannot read B stock through either id pairing", async () => {
    for (const productId of [ctx.catA.product.id, ctx.catB.product.id]) {
      const res = await request(app)
        .get(nested(productId, ctx.catB.variants.in.id))
        .set(adminA());
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
      expect(JSON.stringify(res.body)).not.toContain(`${RUN}-b-in`);
    }
    const ledger = await request(app)
      .get(nested(ctx.catB.product.id, ctx.catB.variants.in.id, "/transactions"))
      .set(adminA());
    expect(ledger.status).toBe(404);
    expect(ledger.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
  });
});

describe("inventory mutation isolation", () => {
  it("A adjusts its own variant with ledger effects", async () => {
    const before = await prisma.inventory.findUnique({ where: { variantId: ctx.catA.variants.in.id } });
    const txBefore = await prisma.inventoryTransaction.count({ where: { variantId: ctx.catA.variants.in.id } });
    const res = await request(app)
      .patch(nested(ctx.catA.product.id, ctx.catA.variants.in.id))
      .set(adminA())
      .send({ quantity: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.inventory.quantity).toBe(before.quantity + 5);
    expect(await prisma.inventoryTransaction.count({ where: { variantId: ctx.catA.variants.in.id } })).toBe(
      txBefore + 1
    );
  });

  it("A cannot adjust B stock and leaves zero side effects", async () => {
    const before = await prisma.inventory.findUnique({ where: { variantId: ctx.catB.variants.in.id } });
    const txBefore = await prisma.inventoryTransaction.count({ where: { variantId: ctx.catB.variants.in.id } });
    const res = await request(app)
      .patch(nested(ctx.catB.product.id, ctx.catB.variants.in.id))
      .set(adminA())
      .send({ quantity: 5 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
    expect(await prisma.inventory.findUnique({ where: { variantId: ctx.catB.variants.in.id } })).toMatchObject({
      quantity: before.quantity,
      reservedQuantity: before.reservedQuantity,
    });
    expect(await prisma.inventoryTransaction.count({ where: { variantId: ctx.catB.variants.in.id } })).toBe(
      txBefore
    );
  });

  it("A cannot initialize stock for B's variant", async () => {
    const res = await request(app)
      .post(nested(ctx.catB.product.id, ctx.catB.variants.in.id))
      .set(adminA())
      .send({ quantity: 3 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
  });

  it("A initializes its own unstocked variant", async () => {
    const res = await request(app)
      .post(nested(ctx.catA.product.id, ctx.catA.variants.bare.id))
      .set(adminA())
      .send({ quantity: 6 });
    expect(res.status).toBe(201);
    expect(res.body.data.inventory.quantity).toBe(6);
  });

  it("existing negative-adjustment and insufficient-stock behavior is unchanged", async () => {
    const neg = await request(app)
      .patch(nested(ctx.catA.product.id, ctx.catA.variants.in.id))
      .set(adminA())
      .send({ quantity: -2 });
    expect(neg.status).toBe(200);
    const tooMuch = await request(app)
      .patch(nested(ctx.catA.product.id, ctx.catA.variants.in.id))
      .set(adminA())
      .send({ quantity: -999999 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("client companyId cannot redirect a mutation", async () => {
    const strict = await request(app)
      .patch(nested(ctx.catA.product.id, ctx.catA.variants.in.id))
      .set(headersFor(ctx.adminA.id))
      .send({ quantity: 1, companyId: ctx.companyB.id });
    expect(strict.status).toBe(422);
    const ignored = await request(app)
      .patch(nested(ctx.catA.product.id, ctx.catA.variants.in.id))
      .query({ companyId: ctx.companyB.id })
      .set({ ...headersFor(ctx.adminA.id), "x-company-id": ctx.companyB.id })
      .send({ quantity: 1 });
    expect(ignored.status).toBe(200);
  });
});

describe("order/return flows and platform boundaries", () => {
  it("checkout decrement and cancel restore still work on own stock", async () => {
    const address = await request(app)
      .post("/api/v1/addresses")
      .set(headersFor(ctx.customerA.id, ["CUSTOMER"]))
      .send({
        fullName: "Inv Iso",
        phone: "9999999999",
        addressLine1: "3 Isolation Road",
        city: "Ludhiana",
        state: "Punjab",
        postalCode: "141002",
        country: "India",
      });
    expect(address.status).toBe(201);
    await request(app)
      .post("/api/v1/cart/items")
      .set(headersFor(ctx.customerA.id, ["CUSTOMER"]))
      .send({ variantId: ctx.catA.variants.in.id, quantity: 2 })
      .expect(200);
    const before = await prisma.inventory.findUnique({ where: { variantId: ctx.catA.variants.in.id } });
    const order = await request(app)
      .post("/api/v1/orders")
      .set(headersFor(ctx.customerA.id, ["CUSTOMER"]))
      .send({ shippingAddressId: address.body.data.address.id });
    expect(order.status).toBe(201);
    const afterCheckout = await prisma.inventory.findUnique({ where: { variantId: ctx.catA.variants.in.id } });
    expect(afterCheckout.quantity).toBe(before.quantity - 2);
    const cancel = await request(app)
      .post(`/api/v1/orders/${order.body.data.order.id}/cancel`)
      .set(headersFor(ctx.customerA.id, ["CUSTOMER"]));
    expect(cancel.status).toBe(200);
    const afterCancel = await prisma.inventory.findUnique({ where: { variantId: ctx.catA.variants.in.id } });
    expect(afterCancel.quantity).toBe(before.quantity);
    const restored = await prisma.inventoryTransaction.findMany({
      where: { variantId: ctx.catA.variants.in.id, type: "ORDER_CANCELLED" },
    });
    expect(restored.length).toBeGreaterThan(0);
  });

  it("SUPER_ADMIN gains no inventory operational bypass", async () => {
    const list = await request(app).get("/api/v1/inventory").set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe("AUTH_FORBIDDEN");
    const detail = await request(app)
      .get(nested(ctx.catA.product.id, ctx.catA.variants.in.id))
      .set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(detail.status).toBe(403);
  });

  it("suspended company inventory reads are rejected (Phase 2C-13)", async () => {
    const res = await request(app)
      .get(nested(ctx.catS.product.id, ctx.catS.variants.in.id))
      .set(headersFor(ctx.adminS.id));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
  });
});
