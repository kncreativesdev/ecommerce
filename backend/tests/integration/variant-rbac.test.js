import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Phase 3-3 variant RBAC slice (live HTTP + MySQL).
 *
 * Variants carry no separate permission namespace in permissions.js —
 * they are product-sub-resource operations covered by the product
 * grants (denormalized companyId, nested creation, no standalone
 * reads), consistent with the Phase 3-2 nested-variant allowance:
 * - POST /products/:productId/variants → ADMIN/HEAD/MEMBER
 *   (MEMBER: no `isActive:false` — 403)
 * - PATCH /products/:productId/variants/:variantId → ADMIN/HEAD/MEMBER
 *   (MEMBER: no explicit `isActive` — 403)
 * - DELETE …/variants/:variantId (soft-deactivate) → ADMIN/HEAD
 *   (MEMBER: 403 at the role gate)
 * - reads: variants surface nested in products (unchanged);
 *   SUPER_ADMIN/CUSTOMER excluded everywhere (403/401).
 *
 * Boundaries keep the pre-existing codes — cross-company and unknown
 * ids read as the neutral 404 — and mutations keep their
 * actor/company-scoped PRODUCT_VARIANT audit events.
 */

const RUN = `TSTVR${Date.now().toString(36).toUpperCase()}`.toLowerCase();
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
      firstName: "Var",
      lastName: tag,
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await ensureRole(roleName);
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function createProduct(tag, companyId, categoryId) {
  const row = await prisma.product.create({
    data: { name: `${RUN} ${tag}`, slug: `${RUN}-${tag}`, categoryId, companyId },
  });
  return row;
}

async function createVariant(productId, tag, companyId, extra = {}) {
  const row = await prisma.productVariant.create({
    data: { productId, sku: `${RUN}-${tag}-sku`, name: `${RUN} ${tag}`, price: "42.00", companyId, ...extra },
  });
  return row;
}

const variantBody = (tag, extra = {}) => ({
  sku: `${RUN}-${tag}-sku`,
  name: `${RUN} ${tag}`,
  price: "42.00",
  ...extra,
});

beforeAll(async () => {
  ctx.superAdmin = await createStaff("super", "SUPER_ADMIN", null);
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    // eslint-disable-next-line no-await-in-loop
    const company = await prisma.company.create({ data: { name: `${RUN} Var Co ${tag}`, status } });
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
  ctx.headS = await createStaff("head-s", "HEAD", ctx.companyS.id);
  ctx.categoryA = await prisma.category.create({ data: { name: `${RUN} cat-a`, slug: `${RUN}-cat-a`, companyId: ctx.companyA.id } });
  ctx.categoryB = await prisma.category.create({ data: { name: `${RUN} cat-b`, slug: `${RUN}-cat-b`, companyId: ctx.companyB.id } });
  ctx.categoryS = await prisma.category.create({ data: { name: `${RUN} cat-s`, slug: `${RUN}-cat-s`, companyId: ctx.companyS.id } });
  ctx.productA = await createProduct("prod-a", ctx.companyA.id, ctx.categoryA.id);
  ctx.productB = await createProduct("prod-b", ctx.companyB.id, ctx.categoryB.id);
  ctx.productS = await createProduct("prod-s", ctx.companyS.id, ctx.categoryS.id);
}, 120000);

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

describe("variant create by role", () => {
  it("ADMIN creates with company inheritance (unchanged)", async () => {
    const res = await request(app).post(`/api/v1/products/${ctx.productA.id}/variants`).set(adminA()).send(variantBody("admin", { isActive: false }));
    expect(res.status).toBe(201);
    expect(res.body.data.variant).toMatchObject({ isActive: false });
    const stored = await prisma.productVariant.findUnique({ where: { id: res.body.data.variant.id } });
    expect(stored.companyId).toBe(ctx.companyA.id);
  });

  it("HEAD creates inheriting the product company", async () => {
    const res = await request(app).post(`/api/v1/products/${ctx.productA.id}/variants`).set(headA()).send(variantBody("head"));
    expect(res.status).toBe(201);
    ctx.headMadeId = res.body.data.variant.id;
    const stored = await prisma.productVariant.findUnique({ where: { id: ctx.headMadeId } });
    expect(stored.companyId).toBe(ctx.companyA.id);
  });

  it("MEMBER creates active; isActive:false is refused with nothing stored", async () => {
    const ok = await request(app).post(`/api/v1/products/${ctx.productA.id}/variants`).set(memberA()).send(variantBody("member"));
    expect(ok.status).toBe(201);
    ctx.memberMadeId = ok.body.data.variant.id;

    const refused = await request(app).post(`/api/v1/products/${ctx.productA.id}/variants`).set(memberA()).send(variantBody("member-dark", { isActive: false }));
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("AUTH_FORBIDDEN");
    expect(await prisma.productVariant.findFirst({ where: { sku: `${RUN}-member-dark-sku` } })).toBeNull();
  });

  it("CUSTOMER, SUPER_ADMIN, and anonymous callers are refused", async () => {
    const customer = await request(app).post(`/api/v1/products/${ctx.productA.id}/variants`).set(headersFor(ctx.customerA.id, ["CUSTOMER"])).send(variantBody("nope-c"));
    expect(customer.status).toBe(403);
    const platform = await request(app).post(`/api/v1/products/${ctx.productA.id}/variants`).set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"])).send(variantBody("nope-s"));
    expect(platform.status).toBe(403);
    const anonymous = await request(app).post(`/api/v1/products/${ctx.productA.id}/variants`).send(variantBody("nope-a"));
    expect(anonymous.status).toBe(401);
  });

  it("body companyId smuggling is rejected; cross-company product reads as missing", async () => {
    const smuggled = await request(app).post(`/api/v1/products/${ctx.productA.id}/variants`).set(headA()).send({ ...variantBody("smuggled"), companyId: ctx.companyB.id });
    expect(smuggled.status).toBe(422);

    const foreignProduct = await request(app).post(`/api/v1/products/${ctx.productB.id}/variants`).set(headA()).send(variantBody("foreign-prod"));
    expect(foreignProduct.status).toBe(404);
    expect(foreignProduct.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });
});

describe("variant update by role", () => {
  it("MEMBER updates fields but cannot touch isActive either way", async () => {
    const ok = await request(app).patch(`/api/v1/products/${ctx.productA.id}/variants/${ctx.memberMadeId}`).set(memberA()).send({ name: `${RUN} Renamed`, price: "43.00" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.variant).toMatchObject({ name: `${RUN} Renamed` });

    for (const isActive of [false, true]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).patch(`/api/v1/products/${ctx.productA.id}/variants/${ctx.memberMadeId}`).set(memberA()).send({ isActive });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    }
    const stored = await prisma.productVariant.findUnique({ where: { id: ctx.memberMadeId } });
    expect(stored).toMatchObject({ isActive: true, name: `${RUN} Renamed` });
  });

  it("HEAD flips isActive both ways; ADMIN behavior unchanged", async () => {
    const off = await request(app).patch(`/api/v1/products/${ctx.productA.id}/variants/${ctx.headMadeId}`).set(headA()).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.variant.isActive).toBe(false);
    const on = await request(app).patch(`/api/v1/products/${ctx.productA.id}/variants/${ctx.headMadeId}`).set(headA()).send({ isActive: true });
    expect(on.status).toBe(200);
    expect(on.body.data.variant.isActive).toBe(true);

    const adminFlip = await request(app).patch(`/api/v1/products/${ctx.productA.id}/variants/${ctx.headMadeId}`).set(adminA()).send({ price: "44.00", isActive: false });
    expect(adminFlip.status).toBe(200);
    expect(adminFlip.body.data.variant).toMatchObject({ isActive: false });
    const back = await request(app).patch(`/api/v1/products/${ctx.productA.id}/variants/${ctx.headMadeId}`).set(adminA()).send({ isActive: true });
    expect(back.status).toBe(200);
  });
});

describe("variant deactivate stays ADMIN/HEAD-only", () => {
  it("HEAD soft-deactivates; MEMBER is refused with the row untouched", async () => {
    const made = await request(app).post(`/api/v1/products/${ctx.productA.id}/variants`).set(headA()).send(variantBody("deactivate-me"));
    expect(made.status).toBe(201);
    const id = made.body.data.variant.id;

    const memberAttempt = await request(app).delete(`/api/v1/products/${ctx.productA.id}/variants/${id}`).set(memberA());
    expect(memberAttempt.status).toBe(403);
    expect((await prisma.productVariant.findUnique({ where: { id } })).isActive).toBe(true);

    const headDelete = await request(app).delete(`/api/v1/products/${ctx.productA.id}/variants/${id}`).set(headA());
    expect(headDelete.status).toBe(200);
    expect(headDelete.body.data.variant.isActive).toBe(false);
  });

  it("CUSTOMER delete stays forbidden; ADMIN delete works", async () => {
    const made = await request(app).post(`/api/v1/products/${ctx.productA.id}/variants`).set(adminA()).send(variantBody("admin-deactivate"));
    expect(made.status).toBe(201);
    const customerDelete = await request(app).delete(`/api/v1/products/${ctx.productA.id}/variants/${made.body.data.variant.id}`).set(headersFor(ctx.customerA.id, ["CUSTOMER"]));
    expect(customerDelete.status).toBe(403);
    const adminDelete = await request(app).delete(`/api/v1/products/${ctx.productA.id}/variants/${made.body.data.variant.id}`).set(adminA());
    expect(adminDelete.status).toBe(200);
    expect(adminDelete.body.data.variant.isActive).toBe(false);
  });
});

describe("variant tenant and suspension boundaries", () => {
  it("suspended-company mutations stay blocked for HEAD", async () => {
    const headS = headersFor(ctx.headS.id, ["HEAD"]);
    const res = await request(app).post(`/api/v1/products/${ctx.productS.id}/variants`).set(headS).send(variantBody("suspended"));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
  });

  it("cross-company variant ids read as neutral 404 with nothing changed", async () => {
    const foreign = await createVariant(ctx.productB.id, "foreign", ctx.companyB.id);
    for (const res of [
      await request(app).patch(`/api/v1/products/${ctx.productB.id}/variants/${foreign.id}`).set(headA()).send({ name: "x" }),
      await request(app).delete(`/api/v1/products/${ctx.productB.id}/variants/${foreign.id}`).set(headA()),
      await request(app).patch(`/api/v1/products/${ctx.productB.id}/variants/${foreign.id}`).set(memberA()).send({ name: "x" }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
    }
    // The MEMBER-gated deactivate route refuses by role before any
    // company scoping runs (correct layering, like products).
    const memberDeleteForeign = await request(app).delete(`/api/v1/products/${ctx.productB.id}/variants/${foreign.id}`).set(memberA());
    expect(memberDeleteForeign.status).toBe(403);
    expect((await prisma.productVariant.findUnique({ where: { id: foreign.id } })).name).toBe(`${RUN} foreign`);
    await prisma.productVariant.delete({ where: { id: foreign.id } });
  });

  it("unknown ids behave exactly like foreign ids", async () => {
    const ghost = "00000000-0000-0000-0000-000000000000";
    const unknown = await request(app).patch(`/api/v1/products/${ctx.productA.id}/variants/${ghost}`).set(headA()).send({ name: "x" });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ success: false, error: { code: "PRODUCT_VARIANT_NOT_FOUND", message: "Product variant not found" } });
  });
});

describe("nested-variant bypass surface", () => {
  it("MEMBER product PATCH cannot carry variants (strict schema, no bypass surface)", async () => {
    const res = await request(app).patch(`/api/v1/products/${ctx.productA.id}`).set(memberA()).send({
      name: `${RUN} Bypass Attempt`,
      variants: [{ sku: `${RUN}-bypass-sku`, name: "Bypass", price: "1.00" }],
    });
    expect(res.status).toBe(422);
    expect(await prisma.productVariant.findFirst({ where: { sku: `${RUN}-bypass-sku` } })).toBeNull();
  });

  it("MEMBER product CREATE with an inactive nested variant is refused atomically", async () => {
    const res = await request(app).post("/api/v1/products").set(memberA()).send({
      name: `${RUN} Nested Dark`,
      categoryId: ctx.categoryA.id,
      variants: [{ sku: `${RUN}-nested-dark-sku`, name: "Dark", price: "1.00", isActive: false }],
    });
    expect(res.status).toBe(403);
    expect(await prisma.product.findFirst({ where: { name: `${RUN} Nested Dark` } })).toBeNull();
  });
});

describe("variant RBAC audit", () => {
  it("records HEAD/MEMBER actor snapshots with safe metadata", async () => {
    const events = await prisma.auditLog.findMany({
      where: { companyId: ctx.companyA.id, resource: "PRODUCT_VARIANT" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.length).toBeGreaterThan(0);
    const roles = new Set(events.map((event) => event.actorRole));
    expect(roles.has("HEAD")).toBe(true);
    expect(roles.has("MEMBER")).toBe(true);
    expect(roles.has("ADMIN")).toBe(true);
    for (const event of events) {
      expect(event.companyId).toBe(ctx.companyA.id);
      expect(["CREATED", "UPDATED", "DEACTIVATED", "REACTIVATED"]).toContain(event.action);
      expect(event.outcome).toBe("SUCCESS");
      const serialized = JSON.stringify(event);
      for (const leaked of ["password", "secret", "token"]) {
        expect(serialized.toLowerCase()).not.toContain(leaked);
      }
    }
    const headCreated = events.find((event) => event.action === "CREATED" && event.actorRole === "HEAD");
    expect(headCreated.details).toMatchObject({ sku: `${RUN}-head-sku` });
  });

  it("refused mutations emit no audit event", async () => {
    const before = await prisma.auditLog.count({ where: { resource: "PRODUCT_VARIANT" } });
    const refused = await request(app).post(`/api/v1/products/${ctx.productA.id}/variants`).set(memberA()).send(variantBody("audit-dark", { isActive: false }));
    expect(refused.status).toBe(403);
    const forbidden = await request(app).delete(`/api/v1/products/${ctx.productA.id}/variants/${ctx.memberMadeId}`).set(memberA());
    expect(forbidden.status).toBe(403);
    expect(await prisma.auditLog.count({ where: { resource: "PRODUCT_VARIANT" } })).toBe(before);
  });
});
