import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-2 order-surface tenant isolation (live HTTP + MySQL).
 *
 * Dedicated companies A and B with provisioned admins, stamped
 * customers, and per-company catalog. Every order read, mutation,
 * aggregate, payment, return, and address use is exercised
 * cross-company: Company B order IDs must behave exactly like unknown
 * ids for Company A callers (404, no number/status/history leakage).
 *
 * Dangling-companyId-over-HTTP is unreachable (foreign keys prevent
 * it) and stays covered by tests/unit/company-context.test.js.
 *
 * Cleanup follows repo convention: cart lines removed, catalog rows
 * deactivated (order history is immutable — orders, users, and
 * companies persist as ordinary rows).
 */

const RUN = `TSTOI${Date.now().toString(36).toUpperCase()}`;

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
      firstName: "OrderIso",
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
      name: `${RUN} Frobnicator ${tag}`,
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
      price: "150.00",
      isActive: true,
      companyId,
    },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, quantity: 20, reservedQuantity: 0 } });
  return { category, product, variant };
}

async function createAddress(userId, city) {
  const res = await request(app)
    .post("/api/v1/addresses")
    .set(headersFor(userId))
    .send({
      fullName: "Order Iso",
      phone: "9999999999",
      addressLine1: "7 Isolation Road",
      city,
      state: "Punjab",
      postalCode: "141002",
      country: "India",
    });
  expect(res.status).toBe(201);
  return res.body.data.address.id;
}

async function addToCart(userId, variantId, quantity = 1) {
  const res = await request(app)
    .post("/api/v1/cart/items")
    .set(headersFor(userId))
    .send({ variantId, quantity });
  expect(res.status).toBe(200);
}

async function checkout(userId, addressId, expectedStatus = 201) {
  const res = await request(app).post("/api/v1/orders").set(headersFor(userId)).send({ shippingAddressId: addressId });
  expect(res.status).toBe(expectedStatus);
  return res;
}

async function adminTransition(adminId, orderId, status) {
  const res = await request(app)
    .patch(`/api/v1/orders/admin/${orderId}/status`)
    .set(headersFor(adminId, ["ADMIN"]))
    .send({ status });
  expect(res.status).toBe(200);
  return res;
}

beforeAll(async () => {
  for (const tag of ["a", "b"]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}` } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN.toLowerCase()}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "OrderIso",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = admin;
  }
  ctx.catA = await createCatalog("a", ctx.companyA.id);
  ctx.catB = await createCatalog("b", ctx.companyB.id);
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.customerB = await createUser("customer-b", "CUSTOMER", ctx.companyB.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);
  ctx.addressA = await createAddress(ctx.customerA.id, "Alpha City");
  ctx.addressB = await createAddress(ctx.customerB.id, "Beta City");

  // A1 PENDING (cancel target), A2 → DELIVERED (returns/payment),
  // A3 + A4 PENDING (bulk), B1 PENDING.
  await addToCart(ctx.customerA.id, ctx.catA.variant.id);
  ctx.orderA1 = (await checkout(ctx.customerA.id, ctx.addressA)).body.data.order;
  await addToCart(ctx.customerA.id, ctx.catA.variant.id);
  ctx.orderA2 = (await checkout(ctx.customerA.id, ctx.addressA)).body.data.order;
  for (const status of ["CONFIRMED", "PROCESSING", "DISPATCHED", "IN_TRANSIT", "ARRIVED_IN_CITY", "OUT_FOR_DELIVERY", "DELIVERED"]) {
    await adminTransition(ctx.adminA.id, ctx.orderA2.id, status);
  }
  await addToCart(ctx.customerA.id, ctx.catA.variant.id);
  ctx.orderA3 = (await checkout(ctx.customerA.id, ctx.addressA)).body.data.order;
  await addToCart(ctx.customerA.id, ctx.catA.variant.id);
  ctx.orderA4 = (await checkout(ctx.customerA.id, ctx.addressA)).body.data.order;
  await addToCart(ctx.customerB.id, ctx.catB.variant.id);
  ctx.orderB1 = (await checkout(ctx.customerB.id, ctx.addressB)).body.data.order;
  expect(ctx.orderA1.status).toBe("PENDING");
  expect(ctx.orderB1.status).toBe("PENDING");
}, 120000);

afterAll(async () => {
  await prisma.cartItem.deleteMany({
    where: { cart: { userId: { in: [ctx.customerA?.id, ctx.customerB?.id].filter(Boolean) } } },
  });
  for (const cat of [ctx.catA, ctx.catB].filter(Boolean)) {
    await prisma.productVariant.updateMany({ where: { id: cat.variant.id }, data: { isActive: false } });
    await prisma.product.updateMany({ where: { id: cat.product.id }, data: { isActive: false } });
    await prisma.category.updateMany({ where: { id: cat.category.id }, data: { isActive: false } });
  }
  await prisma.$disconnect();
});

describe("customer order isolation", () => {
  it("A lists only its own orders", async () => {
    const res = await request(app).get("/api/v1/orders").set(headersFor(ctx.customerA.id));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((o) => o.id);
    expect(ids).toHaveLength(4);
    expect(ids).toContain(ctx.orderA1.id);
    expect(ids).not.toContain(ctx.orderB1.id);
  });

  it("A cannot retrieve B's order by exact id", async () => {
    const res = await request(app).get(`/api/v1/orders/${ctx.orderB1.id}`).set(headersFor(ctx.customerA.id));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    expect(JSON.stringify(res.body)).not.toContain(ctx.orderB1.orderNumber);
  });

  it("B reads its own order as the control", async () => {
    const res = await request(app).get(`/api/v1/orders/${ctx.orderB1.id}`).set(headersFor(ctx.customerB.id));
    expect(res.status).toBe(200);
    expect(res.body.data.order.id).toBe(ctx.orderB1.id);
  });

  it("B cannot cancel A's order; A cancels its own", async () => {
    const cross = await request(app)
      .post(`/api/v1/orders/${ctx.orderA1.id}/cancel`)
      .set(headersFor(ctx.customerB.id));
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe("ORDER_NOT_FOUND");
    const own = await request(app)
      .post(`/api/v1/orders/${ctx.orderA1.id}/cancel`)
      .set(headersFor(ctx.customerA.id));
    expect(own.status).toBe(200);
    expect(own.body.data.order.status).toBe("CANCELLED");
  });

  it("A cannot use B's address at checkout", async () => {
    await addToCart(ctx.customerB.id, ctx.catB.variant.id);
    const res = await checkout(ctx.customerB.id, ctx.addressA, 404);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_ADDRESS_NOT_FOUND");
    const cart = await prisma.cart.findUnique({
      where: { userId: ctx.customerB.id },
      select: { items: { select: { id: true } } },
    });
    await prisma.cartItem.deleteMany({ where: { id: { in: cart.items.map((i) => i.id) } } });
  });
});

describe("admin order isolation", () => {
  it("A lists only Company A orders", async () => {
    const res = await request(app).get("/api/v1/orders/admin").set(headersFor(ctx.adminA.id, ["ADMIN"]));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(4);
    const numbers = res.body.data.orders.map((o) => o.orderNumber);
    expect(numbers).not.toContain(ctx.orderB1.orderNumber);
  });

  it("B lists only its single order", async () => {
    const res = await request(app).get("/api/v1/orders/admin").set(headersFor(ctx.adminB.id, ["ADMIN"]));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data.orders[0].id).toBe(ctx.orderB1.id);
  });

  it("A cannot retrieve B's order by exact id", async () => {
    const res = await request(app)
      .get(`/api/v1/orders/admin/${ctx.orderB1.id}`)
      .set(headersFor(ctx.adminA.id, ["ADMIN"]));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    expect(JSON.stringify(res.body)).not.toContain(ctx.orderB1.orderNumber);
  });

  it("A cannot transition B's order (404, not 409)", async () => {
    const res = await request(app)
      .patch(`/api/v1/orders/admin/${ctx.orderB1.id}/status`)
      .set(headersFor(ctx.adminA.id, ["ADMIN"]))
      .send({ status: "CONFIRMED" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("A cannot run a payment update on B's order", async () => {
    const res = await request(app)
      .patch(`/api/v1/orders/admin/${ctx.orderB1.id}/payment`)
      .set(headersFor(ctx.adminA.id, ["ADMIN"]))
      .send({ status: "PAID" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    const own = await request(app)
      .patch(`/api/v1/orders/admin/${ctx.orderA2.id}/payment`)
      .set(headersFor(ctx.adminA.id, ["ADMIN"]))
      .send({ status: "PAID" });
    expect(own.status).toBe(200);
  });

  it("bulk with a B id fails atomically without leaking B details", async () => {
    const res = await request(app)
      .patch("/api/v1/orders/admin/bulk-status")
      .set(headersFor(ctx.adminA.id, ["ADMIN"]))
      .send({ orderIds: [ctx.orderA3.id, ctx.orderB1.id], status: "CONFIRMED" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORDER_BULK_VALIDATION_FAILED");
    const failure = res.body.error.details.find((f) => f.orderId === ctx.orderB1.id);
    expect(failure.code).toBe("ORDER_NOT_FOUND");
    expect(failure).not.toHaveProperty("orderNumber");
    // All-or-nothing: A3 untouched.
    const reread = await request(app)
      .get(`/api/v1/orders/admin/${ctx.orderA3.id}`)
      .set(headersFor(ctx.adminA.id, ["ADMIN"]));
    expect(reread.body.data.order.status).toBe("PENDING");
  });

  it("pure same-company bulk still succeeds", async () => {
    const res = await request(app)
      .patch("/api/v1/orders/admin/bulk-status")
      .set(headersFor(ctx.adminA.id, ["ADMIN"]))
      .send({ orderIds: [ctx.orderA3.id, ctx.orderA4.id], status: "CONFIRMED" });
    expect(res.status).toBe(200);
    expect(res.body.data.orders.map((o) => o.status)).toEqual(["CONFIRMED", "CONFIRMED"]);
  });

  it("filters stay correct within Company A", async () => {
    const byCity = await request(app)
      .get("/api/v1/orders/admin")
      .query({ city: "Beta City" })
      .set(headersFor(ctx.adminA.id, ["ADMIN"]));
    expect(byCity.status).toBe(200);
    expect(byCity.body.meta.total).toBe(0);
    const bySearch = await request(app)
      .get("/api/v1/orders/admin")
      .query({ search: `Frobnicator a` })
      .set(headersFor(ctx.adminA.id, ["ADMIN"]));
    expect(bySearch.status).toBe(200);
    expect(bySearch.body.meta.total).toBeGreaterThan(0);
    expect(
      bySearch.body.data.orders.every((o) => o.orderNumber !== ctx.orderB1.orderNumber)
    ).toBe(true);
  });

  it("client companyId cannot widen the admin list", async () => {
    const res = await request(app)
      .get("/api/v1/orders/admin")
      .query({ companyId: ctx.companyB.id })
      .set({ ...headersFor(ctx.adminA.id, ["ADMIN"]), "x-company-id": ctx.companyB.id })
      .send({ companyId: ctx.companyB.id });
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(4);
    expect(res.body.data.orders.map((o) => o.id)).not.toContain(ctx.orderB1.id);
  });
});

describe("history, returns, aggregates, platform", () => {
  it("A cannot read B's status history through order detail", async () => {
    const res = await request(app)
      .get(`/api/v1/orders/admin/${ctx.orderB1.id}`)
      .set(headersFor(ctx.adminA.id, ["ADMIN"]));
    expect(res.status).toBe(404);
  });

  it("return endpoints honor the order boundary", async () => {
    const created = await request(app)
      .post(`/api/v1/orders/${ctx.orderA2.id}/returns`)
      .set(headersFor(ctx.customerA.id))
      .send({ reason: "DAMAGED" });
    expect(created.status).toBe(201);
    const crossGet = await request(app)
      .get(`/api/v1/orders/${ctx.orderA2.id}/returns`)
      .set(headersFor(ctx.customerB.id));
    expect(crossGet.status).toBe(404);
    expect(crossGet.body.error.code).toBe("ORDER_NOT_FOUND");
    const crossCreate = await request(app)
      .post(`/api/v1/orders/${ctx.orderA2.id}/returns`)
      .set(headersFor(ctx.customerB.id))
      .send({ reason: "DAMAGED" });
    expect(crossCreate.status).toBe(404);
    const returnId = created.body.data.returnRequest.id;
    const adminCross = await request(app)
      .get(`/api/v1/returns/${returnId}`)
      .set(headersFor(ctx.adminB.id, ["ADMIN"]));
    expect(adminCross.status).toBe(404);
    expect(adminCross.body.error.code).toBe("RETURN_NOT_FOUND");
    const listCross = await request(app).get("/api/v1/returns").set(headersFor(ctx.adminB.id, ["ADMIN"]));
    expect(listCross.status).toBe(200);
    expect(listCross.body.meta.total).toBe(0);
    const listOwn = await request(app).get("/api/v1/returns").set(headersFor(ctx.adminA.id, ["ADMIN"]));
    expect(listOwn.body.meta.total).toBe(1);
  });

  it("dashboard aggregates exclude the other company", async () => {
    const summaryA = await request(app)
      .get("/api/v1/dashboard/summary")
      .query({ range: "year" })
      .set(headersFor(ctx.adminA.id, ["ADMIN"]));
    expect(summaryA.status).toBe(200);
    expect(summaryA.body.data.summary.orders.total).toBe(4);
    const summaryB = await request(app)
      .get("/api/v1/dashboard/summary")
      .query({ range: "year" })
      .set(headersFor(ctx.adminB.id, ["ADMIN"]));
    expect(summaryB.status).toBe(200);
    expect(summaryB.body.data.summary.orders.total).toBe(1);
  });

  it("SUPER_ADMIN stays platform-only with no order bypass", async () => {
    const list = await request(app).get("/api/v1/orders/admin").set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe("AUTH_FORBIDDEN");
    // Platform contexts have no customer order operations at all: the
    // request guard refuses before any query runs (same response for
    // every id — nothing about the order leaks either way).
    const direct = await request(app)
      .get(`/api/v1/orders/${ctx.orderA1.id}`)
      .set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(direct.status).toBe(403);
    expect(direct.body.error.code).toBe("AUTH_COMPANY_REQUIRED");
  });
});
