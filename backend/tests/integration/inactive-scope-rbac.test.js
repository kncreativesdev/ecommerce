import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Phase 3-8 inactive-scope RBAC contract (live HTTP + MySQL).
 *
 * Decision record (see §BG): inactive-record visibility is a separate
 * governance dimension from mutation permission, and the matrix grants
 * no inactive-READ action to any role. The pre-SaaS
 * `requireAdminForInactiveScope` posture stands — ZERO production
 * files changed in this phase:
 * - categories/products `?status=inactive|all` → ADMIN only
 *   (HEAD/MEMBER 403; default scope stays public active-only)
 * - variants: no standalone reads exist; nested variants follow the
 *   enclosing product scope (active-only on default reads)
 * - coupons: `?status=` filter lives on ADMIN/HEAD/MEMBER routes, so
 *   inactive coupon reads are already open to HEAD/MEMBER (locked)
 * - inventory/orders: no inactive concept (statuses ≠ inactive scope);
 *   order admin reads already HEAD/MEMBER per 3-5
 * - returns/marketing/announcements admin reads: ADMIN-only routes
 *   by matrix absence (locked, per 3-6/3-7)
 * - users: MEMBER-scoped list per 2C-31 (unchanged here)
 *
 * Customer reads, suspension gating, company predicates, and audit
 * silence are re-verified around the inactive boundary.
 */

const RUN = `TSTIS${Date.now().toString(36).toUpperCase()}`.toLowerCase();
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
      firstName: "Is",
      lastName: tag,
      phone: "9999999999",
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await ensureRole(roleName);
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

beforeAll(async () => {
  ctx.superAdmin = await createStaff("super", "SUPER_ADMIN", null);
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    // eslint-disable-next-line no-await-in-loop
    const company = await prisma.company.create({ data: { name: `${RUN} Is Co ${tag}`, status } });
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

  const adminHeaders = headersFor(ctx.adminA.id, ["ADMIN"]);
  const category = await request(app).post("/api/v1/categories").set(adminHeaders).send({ name: `${RUN} Active Cat` });
  expect(category.status).toBe(201);
  ctx.categoryActiveId = category.body.data.category.id;
  const parked = await request(app).post("/api/v1/categories").set(adminHeaders).send({ name: `${RUN} Parked Cat` });
  expect(parked.status).toBe(201);
  ctx.categoryInactiveId = parked.body.data.category.id;
  const parkedOff = await request(app).patch(`/api/v1/categories/${ctx.categoryInactiveId}`).set(adminHeaders).send({ isActive: false });
  expect(parkedOff.status).toBe(200);

  const product = await request(app).post("/api/v1/products").set(adminHeaders).send({
    name: `${RUN} Active Prod`,
    categoryId: ctx.categoryActiveId,
    variants: [{ sku: `${RUN}-a-sku`, name: "Standard", price: "10.00" }],
  });
  expect(product.status).toBe(201);
  ctx.productActiveId = product.body.data.product.id;
  const shelved = await request(app).post("/api/v1/products").set(adminHeaders).send({
    name: `${RUN} Shelved Prod`,
    categoryId: ctx.categoryActiveId,
    variants: [{ sku: `${RUN}-s-sku`, name: "Standard", price: "10.00" }],
  });
  expect(shelved.status).toBe(201);
  ctx.productInactiveId = shelved.body.data.product.id;
  const shelvedOff = await request(app).patch(`/api/v1/products/${ctx.productInactiveId}`).set(adminHeaders).send({ isActive: false });
  expect(shelvedOff.status).toBe(200);

  const coupon = await request(app).post("/api/v1/coupons").set(adminHeaders).send({
    code: `${RUN}-SAVE`.toUpperCase().slice(0, 50),
    discountType: "FIXED",
    discountValue: "5.00",
  });
  expect(coupon.status).toBe(201);
  ctx.couponActiveId = coupon.body.data.coupon.id;
  const retired = await request(app).post("/api/v1/coupons").set(adminHeaders).send({
    code: `${RUN}-OLD`.toUpperCase().slice(0, 50),
    discountType: "FIXED",
    discountValue: "5.00",
  });
  expect(retired.status).toBe(201);
  ctx.couponInactiveId = retired.body.data.coupon.id;
  const retiredOff = await request(app).patch(`/api/v1/coupons/${ctx.couponInactiveId}`).set(adminHeaders).send({ isActive: false });
  expect(retiredOff.status).toBe(200);

  const foreign = await prisma.category.create({ data: { name: `${RUN} Foreign`, slug: `${RUN}-foreign`, companyId: ctx.companyB.id, isActive: false } });
  ctx.categoryForeignInactiveId = foreign.id;

  // Registered storefront host for company A: public active-scope
  // reads resolve the company from Host, never from identity.
  const superHeaders = headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
  const dom = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/domains`).set(superHeaders).send({ domain: `${RUN}-shop.example.test` });
  expect(dom.status).toBe(201);
  ctx.hostA = `${RUN}-shop.example.test`;
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
  const companyIds = createdCompanyIds;
  const coupons = await prisma.coupon.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } });
  const couponIds = coupons.map((row) => row.id);
  if (couponIds.length > 0) {
    await prisma.couponHistory.deleteMany({ where: { couponId: { in: couponIds } } });
    await prisma.coupon.deleteMany({ where: { id: { in: couponIds } } });
  }
  const variantWhere = { companyId: { in: companyIds } };
  await prisma.inventoryTransaction.deleteMany({ where: { inventory: { variant: variantWhere } } });
  await prisma.inventory.deleteMany({ where: { variant: variantWhere } });
  await prisma.productVariant.deleteMany({ where: variantWhere });
  await prisma.product.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.category.deleteMany({ where: { companyId: { in: companyIds } } });
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

describe("category inactive scope stays ADMIN-only", () => {
  it("ADMIN reads inactive/all scopes", async () => {
    const inactive = await request(app).get("/api/v1/categories?status=inactive").set(adminA());
    expect(inactive.status).toBe(200);
    expect(inactive.body.data.map((row) => row.id)).toContain(ctx.categoryInactiveId);
    const all = await request(app).get("/api/v1/categories?status=all").set(adminA());
    expect(all.status).toBe(200);
    expect(all.body.data.map((row) => row.id)).toEqual(
      expect.arrayContaining([ctx.categoryActiveId, ctx.categoryInactiveId])
    );
    const detail = await request(app).get(`/api/v1/categories/${ctx.categoryInactiveId}?status=all`).set(adminA());
    expect(detail.status).toBe(200);
  });

  it("HEAD and MEMBER are refused inactive scopes but keep active reads", async () => {
    for (const headers of [headA(), memberA()]) {
      for (const query of ["?status=inactive", "?status=all"]) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(app).get(`/api/v1/categories${query}`).set(headers);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
      }
      // eslint-disable-next-line no-await-in-loop
      const detailAll = await request(app).get(`/api/v1/categories/${ctx.categoryInactiveId}?status=all`).set(headers);
      expect(detailAll.status).toBe(403);
      // eslint-disable-next-line no-await-in-loop
      const detailDefault = await request(app).get(`/api/v1/categories/${ctx.categoryInactiveId}`).set(headers);
      expect(detailDefault.status).toBe(404);
      // eslint-disable-next-line no-await-in-loop
      const active = await request(app).get("/api/v1/categories").set(headers).set("Host", ctx.hostA);
      expect(active.status).toBe(200);
      expect(active.body.data.map((row) => row.id)).toContain(ctx.categoryActiveId);
    }
  });
});

describe("product inactive scope stays ADMIN-only", () => {
  it("ADMIN reads inactive/all scopes with nested variants", async () => {
    const inactive = await request(app).get("/api/v1/products?status=inactive").set(adminA());
    expect(inactive.status).toBe(200);
    expect(inactive.body.data.map((row) => row.id)).toContain(ctx.productInactiveId);
    const detail = await request(app).get(`/api/v1/products/${ctx.productInactiveId}?status=all`).set(adminA());
    expect(detail.status).toBe(200);
  });

  it("HEAD and MEMBER are refused inactive scopes; default reads hide inactive rows", async () => {
    for (const headers of [headA(), memberA()]) {
      for (const query of ["?status=inactive", "?status=all"]) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(app).get(`/api/v1/products${query}`).set(headers);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
      }
      // eslint-disable-next-line no-await-in-loop
      const detailAll = await request(app).get(`/api/v1/products/${ctx.productInactiveId}?status=all`).set(headers);
      expect(detailAll.status).toBe(403);
      // eslint-disable-next-line no-await-in-loop
      const detailDefault = await request(app).get(`/api/v1/products/${ctx.productInactiveId}`).set(headers);
      expect(detailDefault.status).toBe(404);
    }
  });

  it("HEAD and MEMBER keep active-scope product reads via the storefront host", async () => {
    for (const headers of [headA(), memberA()]) {
      // eslint-disable-next-line no-await-in-loop
      const active = await request(app).get("/api/v1/products").set(headers).set("Host", ctx.hostA);
      expect(active.status).toBe(200);
      expect(active.body.data.map((row) => row.id)).toContain(ctx.productActiveId);
    }
  });

  it("no standalone variant reads exist; nested variants follow product scope", async () => {
    const ghost = await request(app).get(`/api/v1/products/${ctx.productActiveId}/variants/00000000-0000-0000-0000-000000000000`).set(headA());
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});

describe("coupon inactive reads are already open to HEAD/MEMBER", () => {
  it("HEAD and MEMBER list inactive coupons and read them", async () => {
    for (const headers of [headA(), memberA()]) {
      // eslint-disable-next-line no-await-in-loop
      const list = await request(app).get("/api/v1/coupons?status=inactive").set(headers);
      expect(list.status).toBe(200);
      expect(list.body.data.coupons.map((row) => row.id)).toContain(ctx.couponInactiveId);
      // eslint-disable-next-line no-await-in-loop
      const detail = await request(app).get(`/api/v1/coupons/${ctx.couponInactiveId}`).set(headers);
      expect(detail.status).toBe(200);
    }
  });
});

describe("other domains are not pulled into inactive-scope logic", () => {
  it("HEAD keeps order/inventory reads; returns/marketing/announcements stay ADMIN-only", async () => {
    expect((await request(app).get("/api/v1/orders/admin").set(headA())).status).toBe(200);
    expect((await request(app).get("/api/v1/inventory").set(headA())).status).toBe(200);
    expect((await request(app).get("/api/v1/returns").set(headA())).status).toBe(403);
    expect((await request(app).get("/api/v1/marketing/notifications/admin").set(headA())).status).toBe(403);
    expect((await request(app).get("/api/v1/announcements/admin").set(headA())).status).toBe(403);
    expect((await request(app).get("/api/v1/returns").set(memberA())).status).toBe(403);
  });
});

describe("inactive-scope security", () => {
  it("foreign inactive rows never enumerate: ADMIN sees own, HEAD is refused", async () => {
    const adminAll = await request(app).get("/api/v1/categories?status=all").set(adminA());
    expect(adminAll.status).toBe(200);
    const ids = adminAll.body.data.map((row) => row.id);
    expect(ids).toContain(ctx.categoryInactiveId);
    expect(ids).not.toContain(ctx.categoryForeignInactiveId);

    const headAll = await request(app).get("/api/v1/categories?status=all").set(headA());
    expect(headAll.status).toBe(403);
  });

  it("suspended company blocks inactive reads before data access", async () => {
    const headS = headersFor(ctx.headS.id, ["HEAD"]);
    for (const path of ["/api/v1/categories?status=inactive", "/api/v1/products?status=all"]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).get(path).set(headS);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
    }
  });

  it("CUSTOMER, SUPER_ADMIN, and anonymous inactive reads refused without oracle", async () => {
    const customer = headersFor(ctx.customerA.id, ["CUSTOMER"]);
    const platform = headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
    expect((await request(app).get("/api/v1/categories?status=inactive").set(customer)).status).toBe(403);
    expect((await request(app).get("/api/v1/categories?status=all").set(platform)).status).toBe(403);
    expect((await request(app).get("/api/v1/categories?status=inactive")).status).toBe(401);
    expect((await request(app).get("/api/v1/products?status=all").set(platform)).status).toBe(403);
  });

  it("reads emit no mutation audit events", async () => {
    const scope = { companyId: { in: createdCompanyIds } };
    const before = await prisma.auditLog.count({ where: scope });
    expect((await request(app).get("/api/v1/categories?status=all").set(adminA())).status).toBe(200);
    expect((await request(app).get("/api/v1/categories?status=inactive").set(headA())).status).toBe(403);
    expect((await request(app).get("/api/v1/coupons?status=inactive").set(memberA())).status).toBe(200);
    expect(await prisma.auditLog.count({ where: scope })).toBe(before);
  });
});
