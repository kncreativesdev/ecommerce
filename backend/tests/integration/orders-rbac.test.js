import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Phase 3-5 orders + payments + bulk RBAC (live HTTP + MySQL).
 *
 * The matrix grants a single order:MANAGE action to ADMIN/HEAD/MEMBER
 * (CUSTOMER keeps order:CREATE/READ on the customer routes), so all
 * five company order routes share one authorization — lifecycle,
 * payment, bulk, transaction, retry, and audit semantics stay
 * role-agnostic in the service:
 * - GET /orders/admin, GET /orders/admin/:id → ADMIN/HEAD/MEMBER
 * - PATCH /orders/admin/:id/status → ADMIN/HEAD/MEMBER
 * - PATCH /orders/admin/:id/payment → ADMIN/HEAD/MEMBER
 * - PATCH /orders/admin/bulk-status → ADMIN/HEAD/MEMBER
 * - SUPER_ADMIN/CUSTOMER excluded everywhere (403/401).
 *
 * Authorization and lifecycle validation stay separate: unauthorized
 * callers stop before mutation; authorized callers get the existing
 * business errors on invalid transitions. Boundaries keep the
 * pre-existing neutral 404s; suspension keeps the central gate.
 */

const RUN = `TSTOR${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const PASSWORD = "TestPass123!";

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function ensureRole(name) {
  let role = await prisma.role.findUnique({ where: { name } });
  if (!role) {
    role = await prisma.role.create({ data: { name } });
  }
  return role;
}

async function createStaff(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      firstName: "Ord",
      lastName: tag,
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await ensureRole(roleName);
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function createCatalog(tag, companyId) {
  const category = await prisma.category.create({
    data: { name: `${RUN} ${tag}`, slug: `${RUN}-${tag}`, companyId },
  });
  const product = await prisma.product.create({
    data: { name: `${RUN} ${tag} prod`, slug: `${RUN}-${tag}-prod`, categoryId: category.id, companyId },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, sku: `${RUN}-${tag}-sku`, name: "Standard", price: "25.00", companyId },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, quantity: 50, reservedQuantity: 0 } });
  return { category, product, variant };
}

async function createCustomer(tag, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      firstName: "Ord",
      lastName: tag,
      phone: "9999999999",
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await ensureRole("CUSTOMER");
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function placeOrder(customerId, addressId, variantId) {
  const token = signAccessToken({ id: customerId, roles: ["CUSTOMER"] });
  const headers = { Authorization: `Bearer ${token}` };
  const added = await request(app).post("/api/v1/cart/items").set(headers).send({ variantId, quantity: 1 });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(headers).send({ shippingAddressId: addressId });
  expect(order.status).toBe(201);
  return order.body.data.order;
}

async function createAddress(customerId) {
  const token = signAccessToken({ id: customerId, roles: ["CUSTOMER"] });
  const res = await request(app)
    .post("/api/v1/addresses")
    .set({ Authorization: `Bearer ${token}` })
    .send({
      fullName: "Ord Tester",
      phone: "9999999999",
      addressLine1: "1 Test Street",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
    });
  expect(res.status).toBe(201);
  return res.body.data.address;
}

beforeAll(async () => {
  ctx.superAdmin = await createStaff("super", "SUPER_ADMIN", null);
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"]]) {
    // eslint-disable-next-line no-await-in-loop
    const company = await prisma.company.create({ data: { name: `${RUN} Ord Co ${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
  }
  ctx.adminA = await createStaff("admin-a", "ADMIN", ctx.companyA.id);
  await prisma.company.update({ where: { id: ctx.companyA.id }, data: { adminUserId: ctx.adminA.id } });
  ctx.headA = await createStaff("head-a", "HEAD", ctx.companyA.id);
  ctx.memberA = await createStaff("member-a", "MEMBER", ctx.companyA.id);
  ctx.customerA = await createStaff("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.adminB = await createStaff("admin-b", "ADMIN", ctx.companyB.id);
  await prisma.company.update({ where: { id: ctx.companyB.id }, data: { adminUserId: ctx.adminB.id } });

  const catA = await createCatalog("cat-a", ctx.companyA.id);
  ctx.variantA = catA.variant;
  const catB = await createCatalog("cat-b", ctx.companyB.id);
  ctx.variantB = catB.variant;

  ctx.customerA = await createCustomer("buyer-a", ctx.companyA.id);
  ctx.customerB = await createCustomer("buyer-b", ctx.companyB.id);
  ctx.addressA = await createAddress(ctx.customerA.id);
  ctx.addressB = await createAddress(ctx.customerB.id);

  ctx.orderAdmin = await placeOrder(ctx.customerA.id, ctx.addressA.id, ctx.variantA.id);
  ctx.orderHead = await placeOrder(ctx.customerA.id, ctx.addressA.id, ctx.variantA.id);
  ctx.orderMember = await placeOrder(ctx.customerA.id, ctx.addressA.id, ctx.variantA.id);
  ctx.orderPay = await placeOrder(ctx.customerA.id, ctx.addressA.id, ctx.variantA.id);
  ctx.orderBulkHead1 = await placeOrder(ctx.customerA.id, ctx.addressA.id, ctx.variantA.id);
  ctx.orderBulkHead2 = await placeOrder(ctx.customerA.id, ctx.addressA.id, ctx.variantA.id);
  ctx.orderBulkMember1 = await placeOrder(ctx.customerA.id, ctx.addressA.id, ctx.variantA.id);
  ctx.orderBulkMember2 = await placeOrder(ctx.customerA.id, ctx.addressA.id, ctx.variantA.id);
  ctx.orderForeign = await placeOrder(ctx.customerB.id, ctx.addressB.id, ctx.variantB.id);
}, 180000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { companyId: { in: createdCompanyIds } },
        { resourceId: { in: createdUserIds } },
        { actorId: { in: createdUserIds } },
      ],
    },
  });
  const companyWhere = { user: { companyId: { in: createdCompanyIds } } };
  const orderIds = (await prisma.order.findMany({ where: companyWhere, select: { id: true } })).map((row) => row.id);
  if (orderIds.length > 0) {
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  // Carts reference variants (Restrict) and must go before variants.
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.address.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.inventoryTransaction.deleteMany({ where: { inventory: { variant: { companyId: { in: createdCompanyIds } } } } });
  await prisma.inventory.deleteMany({ where: { variant: { companyId: { in: createdCompanyIds } } } });
  await prisma.productVariant.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await prisma.product.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await prisma.category.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

const adminA = () => headersFor(ctx.adminA.id, ["ADMIN"]);
const headA = () => headersFor(ctx.headA.id, ["HEAD"]);
const memberA = () => headersFor(ctx.memberA.id, ["MEMBER"]);

describe("order reads by role", () => {
  it("ADMIN, HEAD, and MEMBER list and read company orders", async () => {
    for (const headers of [adminA(), headA(), memberA()]) {
      // eslint-disable-next-line no-await-in-loop
      const list = await request(app).get("/api/v1/orders/admin").set(headers);
      expect(list.status).toBe(200);
      expect(list.body.data.orders.length).toBeGreaterThan(0);
      // eslint-disable-next-line no-await-in-loop
      const detail = await request(app).get(`/api/v1/orders/admin/${ctx.orderAdmin.id}`).set(headers);
      expect(detail.status).toBe(200);
      expect(detail.body.data.order.id).toBe(ctx.orderAdmin.id);
    }
  });

  it("CUSTOMER, SUPER_ADMIN, and anonymous reads stay excluded", async () => {
    expect((await request(app).get("/api/v1/orders/admin").set(headersFor(ctx.customerA.id, ["CUSTOMER"]))).status).toBe(403);
    expect((await request(app).get("/api/v1/orders/admin").set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]))).status).toBe(403);
    expect((await request(app).get("/api/v1/orders/admin")).status).toBe(401);
  });
});

describe("order status transitions by role", () => {
  it("ADMIN, HEAD, and MEMBER move PENDING orders to CONFIRMED", async () => {
    const admin = await request(app).patch(`/api/v1/orders/admin/${ctx.orderAdmin.id}/status`).set(adminA()).send({ status: "CONFIRMED" });
    expect(admin.status).toBe(200);
    const head = await request(app).patch(`/api/v1/orders/admin/${ctx.orderHead.id}/status`).set(headA()).send({ status: "CONFIRMED" });
    expect(head.status).toBe(200);
    const member = await request(app).patch(`/api/v1/orders/admin/${ctx.orderMember.id}/status`).set(memberA()).send({ status: "CONFIRMED" });
    expect(member.status).toBe(200);
    for (const id of [ctx.orderAdmin.id, ctx.orderHead.id, ctx.orderMember.id]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await prisma.order.findUnique({ where: { id }, select: { status: true } })).status).toBe("CONFIRMED");
    }
  });

  it("invalid and same-status transitions keep business errors for authorized roles", async () => {
    const invalid = await request(app).patch(`/api/v1/orders/admin/${ctx.orderAdmin.id}/status`).set(headA()).send({ status: "DELIVERED" });
    expect(invalid.status).toBe(409);
    expect(invalid.body.error.code).toBe("ORDER_INVALID_STATUS_TRANSITION");
    const same = await request(app).patch(`/api/v1/orders/admin/${ctx.orderAdmin.id}/status`).set(memberA()).send({ status: "CONFIRMED" });
    expect(same.status).toBe(409);
    expect(same.body.error.code).toBe("ORDER_STATUS_UNCHANGED");
    expect((await prisma.order.findUnique({ where: { id: ctx.orderAdmin.id }, select: { status: true } })).status).toBe("CONFIRMED");
  });

  it("CUSTOMER, SUPER_ADMIN, and anonymous status writes stay excluded with nothing changed", async () => {
    for (const [label, headers, expected] of [
      ["customer", headersFor(ctx.customerA.id, ["CUSTOMER"]), 403],
      ["super-admin", headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]), 403],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).patch(`/api/v1/orders/admin/${ctx.orderHead.id}/status`).set(headers).send({ status: "PROCESSING" });
      expect(res.status).toBe(expected);
    }
    expect((await request(app).patch(`/api/v1/orders/admin/${ctx.orderHead.id}/status`).send({ status: "PROCESSING" })).status).toBe(401);
    expect((await prisma.order.findUnique({ where: { id: ctx.orderHead.id }, select: { status: true } })).status).toBe("CONFIRMED");
  });
});

describe("payment mutations by role", () => {
  it("MEMBER and HEAD drive the payment machine; invalid moves keep business errors", async () => {
    const paid = await request(app).patch(`/api/v1/orders/admin/${ctx.orderPay.id}/payment`).set(memberA()).send({ status: "PAID" });
    expect(paid.status).toBe(200);

    const invalid = await request(app).patch(`/api/v1/orders/admin/${ctx.orderPay.id}/payment`).set(headA()).send({ status: "PENDING" });
    expect(invalid.status).toBe(409);
    expect(invalid.body.error.code).toBe("PAYMENT_INVALID_STATUS_TRANSITION");

    const refunded = await request(app).patch(`/api/v1/orders/admin/${ctx.orderPay.id}/payment`).set(headA()).send({ status: "REFUNDED" });
    expect(refunded.status).toBe(200);
  });

  it("CUSTOMER payment writes stay excluded", async () => {
    const res = await request(app).patch(`/api/v1/orders/admin/${ctx.orderPay.id}/payment`).set(headersFor(ctx.customerA.id, ["CUSTOMER"])).send({ status: "PAID" });
    expect(res.status).toBe(403);
  });
});

describe("bulk status by role", () => {
  it("HEAD and MEMBER bulks commit atomically", async () => {
    const head = await request(app).patch("/api/v1/orders/admin/bulk-status").set(headA()).send({ orderIds: [ctx.orderBulkHead1.id, ctx.orderBulkHead2.id], status: "CONFIRMED" });
    expect(head.status).toBe(200);
    expect(head.body.data.orders).toHaveLength(2);
    const member = await request(app).patch("/api/v1/orders/admin/bulk-status").set(memberA()).send({ orderIds: [ctx.orderBulkMember1.id, ctx.orderBulkMember2.id], status: "CONFIRMED" });
    expect(member.status).toBe(200);
  });

  it("unauthorized bulk writes nothing; foreign targets fail the whole bulk", async () => {
    const scope = { orderId: { in: [ctx.orderBulkHead1.id, ctx.orderForeign.id] } };
    const before = await prisma.orderStatusHistory.count({ where: scope });
    const customer = await request(app).patch("/api/v1/orders/admin/bulk-status").set(headersFor(ctx.customerA.id, ["CUSTOMER"])).send({ orderIds: [ctx.orderBulkHead1.id], status: "PROCESSING" });
    expect(customer.status).toBe(403);
    const mixed = await request(app).patch("/api/v1/orders/admin/bulk-status").set(headA()).send({ orderIds: [ctx.orderBulkHead1.id, ctx.orderForeign.id], status: "PROCESSING" });
    expect(mixed.status).toBe(409);
    expect(mixed.body.error.code).toBe("ORDER_BULK_VALIDATION_FAILED");
    expect((await prisma.order.findUnique({ where: { id: ctx.orderBulkHead1.id }, select: { status: true } })).status).toBe("CONFIRMED");
    expect((await prisma.order.findUnique({ where: { id: ctx.orderForeign.id }, select: { status: true } })).status).toBe("PENDING");
    expect(await prisma.orderStatusHistory.count({ where: scope })).toBe(before);
  });
});

describe("order tenant and suspension boundaries", () => {
  it("foreign and unknown orders read as neutral 404 with nothing changed", async () => {
    for (const res of [
      await request(app).patch(`/api/v1/orders/admin/${ctx.orderForeign.id}/status`).set(headA()).send({ status: "CONFIRMED" }),
      await request(app).get(`/api/v1/orders/admin/${ctx.orderForeign.id}`).set(memberA()),
      await request(app).patch(`/api/v1/orders/admin/${ctx.orderForeign.id}/payment`).set(memberA()).send({ status: "PAID" }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    }
    const ghost = await request(app).patch("/api/v1/orders/admin/00000000-0000-0000-0000-000000000000/status").set(headA()).send({ status: "CONFIRMED" });
    expect(ghost.status).toBe(404);
    expect(ghost.body).toEqual({ success: false, error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
    expect((await prisma.order.findUnique({ where: { id: ctx.orderForeign.id }, select: { status: true } })).status).toBe("PENDING");
  });

  it("body companyId smuggling is rejected; query/header companyId ignored", async () => {
    const smuggled = await request(app).patch(`/api/v1/orders/admin/${ctx.orderHead.id}/status`).set(headA()).send({ status: "PROCESSING", companyId: ctx.companyB.id });
    expect(smuggled.status).toBe(422);

    const scoped = await request(app).patch(`/api/v1/orders/admin/${ctx.orderHead.id}/status?companyId=${ctx.companyB.id}`).set({ ...headA(), "x-company-id": ctx.companyB.id }).send({ status: "PROCESSING" });
    expect(scoped.status).toBe(200);
    expect((await prisma.order.findUnique({ where: { id: ctx.orderHead.id }, select: { status: true } })).status).toBe("PROCESSING");
  });

  it("suspended company blocks HEAD and MEMBER mutations", async () => {
    const superHeaders = headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
    const suspended = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/suspend`).set(superHeaders);
    expect(suspended.status).toBe(200);
    try {
      const head = await request(app).patch(`/api/v1/orders/admin/${ctx.orderHead.id}/status`).set(headA()).send({ status: "DISPATCHED" });
      expect(head.status).toBe(403);
      expect(head.body.error.code).toBe("COMPANY_SUSPENDED");
      const member = await request(app).patch(`/api/v1/orders/admin/${ctx.orderHead.id}/payment`).set(memberA()).send({ status: "PAID" });
      expect(member.status).toBe(403);
      expect(member.body.error.code).toBe("COMPANY_SUSPENDED");
    } finally {
      const restored = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/restore`).set(superHeaders);
      expect(restored.status).toBe(200);
    }
    expect((await prisma.order.findUnique({ where: { id: ctx.orderHead.id }, select: { status: true } })).status).toBe("PROCESSING");
  });
});

describe("order RBAC audit", () => {
  it("records HEAD/MEMBER snapshots with safe metadata", async () => {
    const events = await prisma.auditLog.findMany({
      where: { companyId: ctx.companyA.id, resource: "ORDER" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.length).toBeGreaterThan(0);
    const roles = new Set(events.map((event) => event.actorRole));
    expect(roles.has("HEAD")).toBe(true);
    expect(roles.has("MEMBER")).toBe(true);
    expect(roles.has("ADMIN")).toBe(true);
    for (const event of events) {
      expect(event.companyId).toBe(ctx.companyA.id);
      expect(event.action).toBe("UPDATED");
      expect(event.outcome).toBe("SUCCESS");
      const serialized = JSON.stringify(event);
      for (const leaked of ["password", "secret", "token"]) {
        expect(serialized.toLowerCase()).not.toContain(leaked);
      }
    }
    const headEvent = events.find((event) => event.actorRole === "HEAD");
    expect(headEvent.resourceId).toBe(ctx.orderHead.id);
  });

  it("rejected authorization and failed business rules emit no success audit", async () => {
    const scope = { resource: "ORDER", companyId: { in: [ctx.companyA.id, ctx.companyB.id] } };
    const before = await prisma.auditLog.count({ where: scope });
    const refused = await request(app).patch(`/api/v1/orders/admin/${ctx.orderHead.id}/status`).set(headersFor(ctx.customerA.id, ["CUSTOMER"])).send({ status: "DISPATCHED" });
    expect(refused.status).toBe(403);
    const failed = await request(app).patch(`/api/v1/orders/admin/${ctx.orderHead.id}/status`).set(headA()).send({ status: "DELIVERED" });
    expect(failed.status).toBe(409);
    expect(await prisma.auditLog.count({ where: scope })).toBe(before);
  });
});
