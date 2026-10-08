import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin, provisionEmployee } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-17 audit instrumentation: users, customers, orders,
 * returns (live HTTP + MySQL).
 *
 * Covers employee provisioning, ban/restore, order status/payment/
 * bulk transitions, return creation, a cross-company isolation proof
 * (foreign mutation writes no audit), and a bulk-rollback proof.
 * Cleanup follows repo convention: carts cleared, catalog
 * deactivated, audit rows removed; orders/users/companies persist as
 * ordinary immutable rows.
 */

const RUN = `TSTAO${Date.now().toString(36).toUpperCase()}`.toLowerCase();

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles = ["ADMIN"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "AuditOrd",
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

async function latestAudit(where) {
  return prisma.auditLog.findFirst({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

function expectCompanyAudit(row, { actorId, actorRole, companyId, action, resource, resourceId }) {
  expect(row).not.toBeNull();
  expect(row.actorId).toBe(actorId);
  expect(row.actorRole).toBe(actorRole);
  expect(row.companyId).toBe(companyId);
  expect(row.action).toBe(action);
  expect(row.resource).toBe(resource);
  expect(row.resourceId).toBe(resourceId);
  expect(row.outcome).toBe("SUCCESS");
  expect(JSON.stringify(row)).not.toMatch(/password|otp|token|hash|secret|cookie|authorization/i);
}

async function createAddress(userId) {
  const res = await request(app).post("/api/v1/addresses").set(headersFor(userId, ["CUSTOMER"])).send({
    fullName: "Audit Ord",
    phone: "9999999999",
    addressLine1: "7 Audit Road",
    city: "Audit City",
    state: "Punjab",
    postalCode: "141002",
    country: "India",
  });
  expect(res.status).toBe(201);
  return res.body.data.address.id;
}

async function checkoutAs(userId, addressId) {
  await request(app)
    .post("/api/v1/cart/items")
    .set(headersFor(userId, ["CUSTOMER"]))
    .send({ variantId: ctx.variantA.id, quantity: 1 });
  const res = await request(app)
    .post("/api/v1/orders")
    .set(headersFor(userId, ["CUSTOMER"]))
    .send({ shippingAddressId: addressId });
  expect(res.status).toBe(201);
  return res.body.data.order;
}

async function adminTransition(orderId, status) {
  const res = await request(app)
    .patch(`/api/v1/orders/admin/${orderId}/status`)
    .set(headersFor(ctx.adminA.id))
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
      email: `${RUN}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "AuditOrd",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = await prisma.user.findUnique({ where: { id: admin.id } });
  }
  const category = await prisma.category.create({
    data: { name: `${RUN} Cat`, slug: `${RUN}-cat`, companyId: ctx.companyA.id },
  });
  ctx.category = category;
  const product = await prisma.product.create({
    data: { name: `${RUN} Widget`, slug: `${RUN}-widget`, categoryId: category.id, companyId: ctx.companyA.id },
  });
  ctx.product = product;
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, sku: `${RUN}-SKU`, name: "Standard", price: "50.00", companyId: ctx.companyA.id },
  });
  ctx.variantA = variant;
  await prisma.inventory.create({ data: { variantId: variant.id, quantity: 50, reservedQuantity: 0 } });
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.customerB = await createUser("customer-b", "CUSTOMER", ctx.companyB.id);
  ctx.addressA = await createAddress(ctx.customerA.id);

  ctx.order1 = await checkoutAs(ctx.customerA.id, ctx.addressA);
  for (const status of ["CONFIRMED", "PROCESSING", "DISPATCHED", "IN_TRANSIT", "ARRIVED_IN_CITY", "OUT_FOR_DELIVERY", "DELIVERED"]) {
    // eslint-disable-next-line no-await-in-loop
    await adminTransition(ctx.order1.id, status);
  }
  ctx.order2 = await checkoutAs(ctx.customerA.id, ctx.addressA);
  ctx.order3 = await checkoutAs(ctx.customerA.id, ctx.addressA);
}, 180000);

afterAll(async () => {
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
  await prisma.auditLog.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await prisma.productVariant.updateMany({ where: { productId: ctx.product?.id }, data: { isActive: false } });
  await prisma.product.updateMany({ where: { id: ctx.product?.id }, data: { isActive: false } });
  await prisma.category.updateMany({ where: { id: ctx.category?.id }, data: { isActive: false } });
  await prisma.$disconnect();
});

describe("employee and customer audits", () => {
  it("HEAD/MEMBER provisioning is recorded with the creator as actor", async () => {
    const head = await provisionEmployee(
      { id: ctx.adminA.id, companyId: ctx.companyA.id, roles: ["ADMIN"] },
      { email: `${RUN}-head@example.test`, password: "TestPass123!", firstName: "AuditOrd", lastName: "Head", role: "HEAD" }
    );
    createdUserIds.push(head.id);
    ctx.head = head;
    const headRow = await latestAudit({ resource: "USER", resourceId: head.id });
    expectCompanyAudit(headRow, {
      actorId: ctx.adminA.id,
      actorRole: "ADMIN",
      companyId: ctx.companyA.id,
      action: "CREATED",
      resource: "USER",
      resourceId: head.id,
    });
    expect(headRow.details).toMatchObject({ email: `${RUN}-head@example.test`, role: "HEAD" });

    const member = await provisionEmployee(
      { id: head.id, companyId: ctx.companyA.id, roles: ["HEAD"] },
      { email: `${RUN}-member@example.test`, password: "TestPass123!", firstName: "AuditOrd", lastName: "Member", role: "MEMBER" }
    );
    createdUserIds.push(member.id);
    const memberRow = await latestAudit({ resource: "USER", resourceId: member.id });
    expectCompanyAudit(memberRow, {
      actorId: head.id,
      actorRole: "HEAD",
      companyId: ctx.companyA.id,
      action: "CREATED",
      resource: "USER",
      resourceId: member.id,
    });
  });

  it("customer ban/restore is recorded", async () => {
    const target = await createUser("bantarget", "CUSTOMER", ctx.companyA.id);
    const banned = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set(headersFor(ctx.adminA.id))
      .send({ isActive: false });
    expect(banned.status).toBe(200);
    const banRow = await latestAudit({ resource: "USER", resourceId: target.id });
    expectCompanyAudit(banRow, {
      actorId: ctx.adminA.id,
      actorRole: "ADMIN",
      companyId: ctx.companyA.id,
      action: "DEACTIVATED",
      resource: "USER",
      resourceId: target.id,
    });

    const restored = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set(headersFor(ctx.adminA.id))
      .send({ isActive: true });
    expect(restored.status).toBe(200);
    expect((await latestAudit({ resource: "USER", resourceId: target.id })).action).toBe("REACTIVATED");
  });
});

describe("order audits", () => {
  it("status transitions are recorded with from/to", async () => {
    const row = await latestAudit({ resource: "ORDER", resourceId: ctx.order1.id, action: "UPDATED" });
    expectCompanyAudit(row, {
      actorId: ctx.adminA.id,
      actorRole: "ADMIN",
      companyId: ctx.companyA.id,
      action: "UPDATED",
      resource: "ORDER",
      resourceId: ctx.order1.id,
    });
    expect(row.details).toMatchObject({ from: "OUT_FOR_DELIVERY", to: "DELIVERED" });
    const count = await prisma.auditLog.count({
      where: { companyId: ctx.companyA.id, resource: "ORDER", resourceId: ctx.order1.id },
    });
    expect(count).toBe(7);
  });

  it("payment transitions are recorded", async () => {
    const res = await request(app)
      .patch(`/api/v1/orders/admin/${ctx.order2.id}/payment`)
      .set(headersFor(ctx.adminA.id))
      .send({ status: "PAID" });
    expect(res.status).toBe(200);
    const row = await latestAudit({ resource: "ORDER", resourceId: ctx.order2.id });
    expectCompanyAudit(row, {
      actorId: ctx.adminA.id,
      actorRole: "ADMIN",
      companyId: ctx.companyA.id,
      action: "UPDATED",
      resource: "ORDER",
      resourceId: ctx.order2.id,
    });
    expect(row.details).toMatchObject({ from: "PENDING", to: "PAID", scope: "payment" });
  });

  it("bulk transitions record one event per order", async () => {
    const res = await request(app)
      .patch("/api/v1/orders/admin/bulk-status")
      .set(headersFor(ctx.adminA.id))
      .send({ orderIds: [ctx.order2.id, ctx.order3.id], status: "CONFIRMED" });
    expect(res.status).toBe(200);
    for (const order of [ctx.order2, ctx.order3]) {
      // eslint-disable-next-line no-await-in-loop
      const row = await latestAudit({ resource: "ORDER", resourceId: order.id });
      expectCompanyAudit(row, {
        actorId: ctx.adminA.id,
        actorRole: "ADMIN",
        companyId: ctx.companyA.id,
        action: "UPDATED",
        resource: "ORDER",
        resourceId: order.id,
      });
      expect(row.details).toMatchObject({ from: "PENDING", to: "CONFIRMED" });
    }
  });

  it("a failed bulk rolls back every audit row", async () => {
    const fresh = await checkoutAs(ctx.customerA.id, ctx.addressA);
    const before = await prisma.auditLog.count({
      where: { companyId: ctx.companyA.id, resource: "ORDER", resourceId: fresh.id },
    });
    // order1 is DELIVERED: an illegal target that fails the whole bulk.
    const res = await request(app)
      .patch("/api/v1/orders/admin/bulk-status")
      .set(headersFor(ctx.adminA.id))
      .send({ orderIds: [fresh.id, ctx.order1.id], status: "CONFIRMED" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORDER_BULK_VALIDATION_FAILED");
    expect(
      await prisma.auditLog.count({
        where: { companyId: ctx.companyA.id, resource: "ORDER", resourceId: fresh.id },
      })
    ).toBe(before);
    const still = await prisma.order.findUnique({ where: { id: fresh.id }, select: { status: true } });
    expect(still.status).toBe("PENDING");
  });

  it("a mid-transaction failure rolls back the audit with the mutation", async () => {
    const variant = await prisma.productVariant.create({
      data: {
        productId: ctx.product.id,
        sku: `${RUN}-SKU-RB`,
        name: "Rollback",
        price: "60.00",
        companyId: ctx.companyA.id,
      },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, quantity: 5, reservedQuantity: 0 } });
    await request(app)
      .post("/api/v1/cart/items")
      .set(headersFor(ctx.customerA.id, ["CUSTOMER"]))
      .send({ variantId: variant.id, quantity: 1 });
    const order = (
      await request(app)
        .post("/api/v1/orders")
        .set(headersFor(ctx.customerA.id, ["CUSTOMER"]))
        .send({ shippingAddressId: ctx.addressA })
    ).body.data.order;
    // Remove the stock row (ledger first — it references the row):
    // cancellation restores stock first, so the transaction throws
    // AFTER the status write — everything (status, ledger, audit) must
    // roll back together.
    await prisma.inventoryTransaction.deleteMany({ where: { variantId: variant.id } });
    await prisma.inventory.delete({ where: { variantId: variant.id } });
    const res = await request(app)
      .patch(`/api/v1/orders/admin/${order.id}/status`)
      .set(headersFor(ctx.adminA.id))
      .send({ status: "CANCELLED" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORDER_INVENTORY_MISSING");
    expect((await prisma.order.findUnique({ where: { id: order.id }, select: { status: true } })).status).toBe(
      "PENDING"
    );
    expect(
      await prisma.auditLog.count({ where: { companyId: ctx.companyA.id, resource: "ORDER", resourceId: order.id } })
    ).toBe(0);
  });

  it("cross-company mutations write no audit and change nothing", async () => {
    const before = await prisma.auditLog.count({
      where: { companyId: ctx.companyB.id, resource: "ORDER", resourceId: ctx.order2.id },
    });
    const res = await request(app)
      .patch(`/api/v1/orders/admin/${ctx.order2.id}/status`)
      .set(headersFor(ctx.adminB.id))
      .send({ status: "PROCESSING" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    expect(
      await prisma.auditLog.count({
        where: { companyId: ctx.companyB.id, resource: "ORDER", resourceId: ctx.order2.id },
      })
    ).toBe(before);
    expect(
      await prisma.auditLog.count({ where: { resource: "ORDER", resourceId: ctx.order2.id, actorId: ctx.adminB.id } })
    ).toBe(0);
    const untouched = await prisma.order.findUnique({ where: { id: ctx.order2.id }, select: { status: true } });
    expect(untouched.status).toBe("CONFIRMED");
  });
});

describe("return audits", () => {
  it("return creation is recorded with order and reason", async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${ctx.order1.id}/returns`)
      .set(headersFor(ctx.customerA.id, ["CUSTOMER"]))
      .send({ reason: "DAMAGED" });
    expect(res.status).toBe(201);
    const created = res.body.data.returnRequest ?? res.body.data.return;
    const row = await latestAudit({ resource: "RETURN", resourceId: created.id });
    expectCompanyAudit(row, {
      actorId: ctx.customerA.id,
      actorRole: "CUSTOMER",
      companyId: ctx.companyA.id,
      action: "CREATED",
      resource: "RETURN",
      resourceId: created.id,
    });
    expect(row.details).toMatchObject({ orderId: ctx.order1.id, reason: "DAMAGED" });
  });
});
