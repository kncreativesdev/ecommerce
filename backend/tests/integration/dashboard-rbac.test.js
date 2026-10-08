import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Phase 4-2 operational dashboard RBAC posture (live HTTP + MySQL).
 *
 * Decision record (see §BH): the operational summary stays
 * intentionally ADMIN-only. `company_statistics:READ` is granted to
 * SUPER_ADMIN + ADMIN only — HEAD/MEMBER hold no grant — and the
 * route already enforces exactly that (SUPER_ADMIN is refused at the
 * role gate so platform context never becomes company scope):
 * - ADMIN → 200 aggregates (company-scoped, no PII)
 * - HEAD/MEMBER/CUSTOMER → 403, SUPER_ADMIN → 403, anon → 401
 * - suspended company → 403 COMPANY_SUSPENDED before any query
 * - unknown query params (incl. companyId) stripped, never trusted
 * - audit analytics (`GET /audit-logs/summary`) untouched: HEAD
 *   keeps its existing visibility there under separate rules
 * - refusals and reads emit no mutation audit events
 */

const RUN = `TSTDB${Date.now().toString(36).toUpperCase()}`.toLowerCase();
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
      firstName: "Db",
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
  for (const [tag, status] of [["a", "ACTIVE"], ["s", "SUSPENDED"]]) {
    // eslint-disable-next-line no-await-in-loop
    const company = await prisma.company.create({ data: { name: `${RUN} Db Co ${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
  }
  ctx.adminA = await createStaff("admin-a", "ADMIN", ctx.companyA.id);
  await prisma.company.update({ where: { id: ctx.companyA.id }, data: { adminUserId: ctx.adminA.id } });
  ctx.headA = await createStaff("head-a", "HEAD", ctx.companyA.id);
  ctx.memberA = await createStaff("member-a", "MEMBER", ctx.companyA.id);
  ctx.customerA = await createStaff("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.headS = await createStaff("head-s", "HEAD", ctx.companyS.id);
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
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

const adminA = () => headersFor(ctx.adminA.id, ["ADMIN"]);

describe("operational dashboard role posture", () => {
  it("ADMIN reads the aggregate summary with no row-level or PII data", async () => {
    const res = await request(app).get("/api/v1/dashboard/summary").set(adminA());
    expect(res.status).toBe(200);
    const summary = res.body.data.summary;
    expect(Object.keys(summary).sort()).toEqual(
      ["buckets", "generatedAt", "granularity", "inventory", "orders", "period", "periodEnd", "periodStart", "range", "revenue"].sort()
    );
    expect(summary.orders).toMatchObject({ total: 0 });
    expect(summary.revenue).toMatchObject({ total: "0.00" });
    expect(summary.inventory).toMatchObject({ tracked: 0, outOfStock: 0, uninitialized: 0 });
    const serialized = JSON.stringify(res.body);
    for (const leaked of ["password", "secret", "token", "@example.test"]) {
      expect(serialized.toLowerCase()).not.toContain(leaked);
    }
  });

  it("HEAD, MEMBER, and CUSTOMER stay forbidden with nothing returned", async () => {
    for (const [role, id] of [["HEAD", ctx.headA.id], ["MEMBER", ctx.memberA.id], ["CUSTOMER", ctx.customerA.id]]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).get("/api/v1/dashboard/summary").set(headersFor(id, [role]));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
      expect(res.body.data).toBeUndefined();
    }
  });

  it("SUPER_ADMIN platform context gains no company aggregates; anonymous denied", async () => {
    const platform = await request(app).get("/api/v1/dashboard/summary").set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(platform.status).toBe(403);
    expect(platform.body.data).toBeUndefined();
    expect((await request(app).get("/api/v1/dashboard/summary")).status).toBe(401);
  });

  it("invalid range stays 422; companyId query/header never trusted", async () => {
    expect((await request(app).get("/api/v1/dashboard/summary?range=fortnight").set(adminA())).status).toBe(422);
    const smuggled = await request(app)
      .get(`/api/v1/dashboard/summary?companyId=${ctx.companyS.id}&range=today`)
      .set({ ...adminA(), "x-company-id": ctx.companyS.id });
    expect(smuggled.status).toBe(200);
    expect(smuggled.body.data.summary.orders).toMatchObject({ total: 0 });
  });
});

describe("dashboard suspension and audit silence", () => {
  it("suspended company blocks HEAD before any query runs", async () => {
    const headS = headersFor(ctx.headS.id, ["HEAD"]);
    const res = await request(app).get("/api/v1/dashboard/summary").set(headS);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
    expect(res.body.data).toBeUndefined();
  });

  it("reads and refusals emit no mutation audit events", async () => {
    const scope = { companyId: { in: createdCompanyIds } };
    const before = await prisma.auditLog.count({ where: scope });
    expect((await request(app).get("/api/v1/dashboard/summary").set(adminA())).status).toBe(200);
    expect((await request(app).get("/api/v1/dashboard/summary").set(headersFor(ctx.headA.id, ["HEAD"]))).status).toBe(403);
    expect(await prisma.auditLog.count({ where: scope })).toBe(before);
  });

  it("audit analytics stay separately available to HEAD", async () => {
    const res = await request(app).get("/api/v1/audit-logs/summary").set(headersFor(ctx.headA.id, ["HEAD"]));
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toBeDefined();
  });
});
