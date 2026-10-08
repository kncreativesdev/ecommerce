import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-1 cart → checkout tenant isolation (live HTTP + MySQL).
 *
 * Dedicated companies A and B each own a category/product/variant/
 * inventory chain. All cross-company attacks must fail with the same
 * not-found shape as unknown ids (no existence oracle), and no order
 * may ever consume another company's data. Successful same-company
 * checkout still works end to end (cart → order → inventory decrement).
 *
 * Cleanup follows repo convention: cart lines removed, catalog rows
 * deactivated (never deleted — order history is immutable), users and
 * orders persist as ordinary rows.
 */

const RUN = `TSTCI${Date.now().toString(36).toUpperCase()}`;

const ctx = {};
const createdUserIds = [];

const headersFor = (id, roles = ["CUSTOMER"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN.toLowerCase()}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Isolation",
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

async function createCatalog(tag, companyId, price, quantity) {
  const category = await prisma.category.create({
    data: { name: `${RUN} Cat ${tag}`, slug: `${RUN.toLowerCase()}-cat-${tag}`, companyId },
  });
  const product = await prisma.product.create({
    data: {
      name: `${RUN} Product ${tag}`,
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
  for (const tag of ["a", "b"]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}` } });
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN.toLowerCase()}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "Isolation",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = admin;
  }
  ctx.catA = await createCatalog("a", ctx.companyA.id, "100.00", 10);
  ctx.catB = await createCatalog("b", ctx.companyB.id, "200.00", 10);
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.customerB = await createUser("customer-b", "CUSTOMER", ctx.companyB.id);

  const address = await request(app)
    .post("/api/v1/addresses")
    .set(headersFor(ctx.customerA.id))
    .send({
      fullName: "Isolation Alpha",
      phone: "9999999999",
      addressLine1: "1 Company A Street",
      city: "Ludhiana",
      state: "Punjab",
      postalCode: "141002",
      country: "India",
    });
  expect(address.status).toBe(201);
  ctx.addressId = address.body.data.address.id;
}, 90000);

afterAll(async () => {
  const variantIds = [ctx.catA?.variant.id, ctx.catB?.variant.id].filter(Boolean);
  if (variantIds.length > 0) {
    await prisma.cartItem.deleteMany({ where: { variantId: { in: variantIds } } });
  }
  for (const cat of [ctx.catA, ctx.catB].filter(Boolean)) {
    await prisma.productVariant.updateMany({ where: { id: cat.variant.id }, data: { isActive: false } });
    await prisma.product.updateMany({ where: { id: cat.product.id }, data: { isActive: false } });
    await prisma.category.updateMany({ where: { id: cat.category.id }, data: { isActive: false } });
  }
  await prisma.$disconnect();
});

describe("same-company cart access", () => {
  it("A adds its own variant and reads its own cart", async () => {
    const added = await request(app)
      .post("/api/v1/cart/items")
      .set(headersFor(ctx.customerA.id))
      .send({ variantId: ctx.catA.variant.id, quantity: 2 });
    expect(added.status).toBe(200);
    const cart = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA.id));
    expect(cart.status).toBe(200);
    expect(cart.body.data.cart.items.map((i) => i.variantId)).toContain(ctx.catA.variant.id);
    ctx.itemAId = cart.body.data.cart.items.find((i) => i.variantId === ctx.catA.variant.id).id;
  });

  it("B cannot read A's cart and sees only its own (empty) cart", async () => {
    const cart = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerB.id));
    expect(cart.status).toBe(200);
    expect(cart.body.data.cart.items.map((i) => i.variantId)).not.toContain(ctx.catA.variant.id);
  });
});

describe("cross-company cart attacks fail safely", () => {
  it("B cannot mutate A's cart lines", async () => {
    const patch = await request(app)
      .patch(`/api/v1/cart/items/${ctx.itemAId}`)
      .set(headersFor(ctx.customerB.id))
      .send({ quantity: 9 });
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe("CART_ITEM_NOT_FOUND");
    const del = await request(app)
      .delete(`/api/v1/cart/items/${ctx.itemAId}`)
      .set(headersFor(ctx.customerB.id));
    expect(del.status).toBe(404);
    expect(del.body.error.code).toBe("CART_ITEM_NOT_FOUND");
  });

  it("A cannot add B's variant (same shape as an unknown id)", async () => {
    const cross = await request(app)
      .post("/api/v1/cart/items")
      .set(headersFor(ctx.customerA.id))
      .send({ variantId: ctx.catB.variant.id, quantity: 1 });
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
    // randomUUID: valid v4 shape (passes strict Zod validation) but
    // nonexistent — the comparable unknown-id control.
    const unknown = await request(app)
      .post("/api/v1/cart/items")
      .set(headersFor(ctx.customerA.id))
      .send({ variantId: randomUUID(), quantity: 1 });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
    // The failed add left no trace in A's cart.
    const cart = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA.id));
    expect(cart.body.data.cart.items.map((i) => i.variantId)).not.toContain(ctx.catB.variant.id);
  });

  it("client-supplied companyId cannot smuggle B's variant in", async () => {
    const strict = await request(app)
      .post("/api/v1/cart/items")
      .set(headersFor(ctx.customerA.id))
      .send({ variantId: ctx.catB.variant.id, quantity: 1, companyId: ctx.companyA.id });
    expect(strict.status).toBe(422);
    const ignored = await request(app)
      .post("/api/v1/cart/items")
      .query({ companyId: ctx.companyB.id })
      .set({ ...headersFor(ctx.customerA.id), "x-company-id": ctx.companyB.id })
      .send({ variantId: ctx.catA.variant.id, quantity: 1 });
    expect(ignored.status).toBe(200);
  });
});

describe("checkout isolation inside the order transaction", () => {
  it("rejects a cart contaminated with a cross-company line without creating an order", async () => {
    const cart = await prisma.cart.findUnique({ where: { userId: ctx.customerA.id }, select: { id: true } });
    // Simulate a pre-enforcement contamination vector: a B line written
    // past the service layer. Checkout must still refuse atomically.
    const planted = await prisma.cartItem.create({
      data: { cartId: cart.id, variantId: ctx.catB.variant.id, quantity: 1 },
    });
    const ordersBefore = await prisma.order.count({ where: { userId: ctx.customerA.id } });
    const inventoryBefore = await prisma.inventory.findUnique({
      where: { variantId: ctx.catB.variant.id },
      select: { quantity: true, reservedQuantity: true },
    });
    const checkout = await request(app)
      .post("/api/v1/orders")
      .set(headersFor(ctx.customerA.id))
      .send({ shippingAddressId: ctx.addressId });
    expect(checkout.status).toBe(404);
    expect(checkout.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
    // Atomic refusal: no order, no stock movement, line untouched.
    expect(await prisma.order.count({ where: { userId: ctx.customerA.id } })).toBe(ordersBefore);
    expect(await prisma.inventory.findUnique({ where: { variantId: ctx.catB.variant.id } })).toMatchObject(
      inventoryBefore
    );
    expect(await prisma.cartItem.findUnique({ where: { id: planted.id } })).not.toBeNull();
    await prisma.cartItem.delete({ where: { id: planted.id } });
  });

  it("successful same-company checkout keeps Company A ownership end to end", async () => {
    const checkout = await request(app)
      .post("/api/v1/orders")
      .set(headersFor(ctx.customerA.id))
      .send({ shippingAddressId: ctx.addressId });
    expect(checkout.status).toBe(201);
    const orderId = checkout.body.data.order.id;
    const stored = await prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, items: { select: { variantId: true, productId: true, quantity: true } } },
    });
    expect(stored.userId).toBe(ctx.customerA.id);
    expect(stored.items.length).toBeGreaterThan(0);
    for (const line of stored.items) {
      const variant = await prisma.productVariant.findUnique({
        where: { id: line.variantId },
        select: { companyId: true, product: { select: { companyId: true } } },
      });
      expect(variant.companyId).toBe(ctx.companyA.id);
      expect(variant.product.companyId).toBe(ctx.companyA.id);
      expect(line.productId).not.toBe(ctx.catB.product.id);
    }
    // Inventory decremented exactly for the consumed Company A lines.
    const inventory = await prisma.inventory.findUnique({ where: { variantId: ctx.catA.variant.id } });
    const orderedQty = stored.items
      .filter((line) => line.variantId === ctx.catA.variant.id)
      .reduce((sum, line) => sum + line.quantity, 0);
    expect(inventory.quantity).toBe(10 - orderedQty);
  });
});
