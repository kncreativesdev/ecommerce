import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin, provisionEmployee } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-24 audit analytics (live HTTP + MySQL).
 *
 * GET /api/v1/audit-logs/summary aggregates EXACTLY the rows each
 * viewer could list (shared visibility builder with the read/export
 * paths): MEMBER self-only, HEAD self+members, ADMIN company,
 * SUPER_ADMIN selected scope. Company #1 is untouched. Reads are
 * strictly non-mutating (proven by row counts).
 */

const RUN = `TSTAS${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const DAY_MS = 24 * 60 * 60 * 1000;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "AuditSum",
      lastName: tag,
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

async function seedRow({ actorId, actorRole, companyId, action, resource, outcome = "SUCCESS", createdAt }) {
  return prisma.auditLog.create({
    data: {
      actorId,
      actorRole,
      actorEmail: `${RUN}-seed@example.test`,
      companyId,
      action,
      resource,
      resourceId: randomUUID(),
      outcome,
      details: { seed: RUN },
      createdAt,
    },
  });
}

const get = (headers, query = "") => request(app).get(`/api/v1/audit-logs/summary${query}`).set(headers);

beforeAll(async () => {
  ctx.now = Date.now();
  for (const tag of ["a", "b"]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}` } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "AuditSum",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = await prisma.user.findUnique({ where: { id: admin.id } });
  }
  const headA = await provisionEmployee(
    { id: ctx.adminA.id, companyId: ctx.companyA.id, roles: ["ADMIN"] },
    { email: `${RUN}-head-a@example.test`, password: "TestPass123!", firstName: "AuditSum", lastName: "HeadA", role: "HEAD" }
  );
  createdUserIds.push(headA.id);
  ctx.headA = headA;
  // Peer HEAD in the SAME company: invisible to headA everywhere,
  // including aggregates.
  const headA2 = await provisionEmployee(
    { id: ctx.adminA.id, companyId: ctx.companyA.id, roles: ["ADMIN"] },
    { email: `${RUN}-head-a2@example.test`, password: "TestPass123!", firstName: "AuditSum", lastName: "HeadA2", role: "HEAD" }
  );
  createdUserIds.push(headA2.id);
  ctx.headA2 = headA2;
  for (const tag of ["m1", "m2"]) {
    const member = await provisionEmployee(
      { id: headA.id, companyId: ctx.companyA.id, roles: ["HEAD"] },
      { email: `${RUN}-member-a-${tag}@example.test`, password: "TestPass123!", firstName: "AuditSum", lastName: `Member${tag}`, role: "MEMBER" }
    );
    createdUserIds.push(member.id);
    ctx[`member${tag.toUpperCase()}`] = member;
  }
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);

  const at = (daysAgo, hoursAgo = 0) => new Date(ctx.now - daysAgo * DAY_MS - hoursAgo * 3600000);
  // Company A activity (deterministic timestamps). NOTE: the five
  // provisioning calls above also wrote in-window USER/CREATED rows
  // (company-admin by SYSTEM, headA/headA2 by adminA, m1/m2 by
  // headA), which the expectations below account for exactly.
  ctx.row5d = await seedRow({ actorId: ctx.memberM1.id, actorRole: "MEMBER", companyId: ctx.companyA.id, action: "CREATED", resource: "USER", createdAt: at(5) });
  await seedRow({ actorId: ctx.memberM1.id, actorRole: "MEMBER", companyId: ctx.companyA.id, action: "UPDATED", resource: "PRODUCT", createdAt: at(2) });
  await seedRow({ actorId: ctx.memberM2.id, actorRole: "MEMBER", companyId: ctx.companyA.id, action: "CREATED", resource: "USER", createdAt: at(2) });
  await seedRow({ actorId: ctx.headA.id, actorRole: "HEAD", companyId: ctx.companyA.id, action: "CREATED", resource: "CATEGORY", createdAt: at(1) });
  await seedRow({ actorId: ctx.headA2.id, actorRole: "HEAD", companyId: ctx.companyA.id, action: "DELETED", resource: "COUPON", createdAt: at(1) });
  await seedRow({ actorId: ctx.adminA.id, actorRole: "ADMIN", companyId: ctx.companyA.id, action: "UPDATED", resource: "ORDER", outcome: "FAILURE", createdAt: at(0, 2) });
  // Company B activity (must never leak into A-scoped aggregates).
  await seedRow({ actorId: ctx.adminB.id, actorRole: "ADMIN", companyId: ctx.companyB.id, action: "CREATED", resource: "PRODUCT", createdAt: at(1) });
  // Outside the default 30-day window (default-period exclusion proof).
  await seedRow({ actorId: ctx.adminA.id, actorRole: "ADMIN", companyId: ctx.companyA.id, action: "CREATED", resource: "USER", createdAt: at(40) });
  // Platform row (null scope): proves the null filter is non-vacuous.
  // Tracked by id for cleanup (null-company rows belong to no company).
  ctx.platformRow = await seedRow({ actorId: ctx.superAdmin.id, actorRole: "SUPER_ADMIN", companyId: null, action: "CREATED", resource: "COMPANY", createdAt: at(1) });

  // Suspended company D with its own history.
  const companyD = await prisma.company.create({ data: { name: `${RUN}-co-d`, status: "SUSPENDED" } });
  createdCompanyIds.push(companyD.id);
  ctx.companyD = companyD;
  const adminD = await provisionCompanyAdmin(ctx.companyD.id, {
    email: `${RUN}-admin-d@example.test`,
    password: "TestPass123!",
    firstName: "AuditSum",
    lastName: "AdminD",
  });
  createdUserIds.push(adminD.id);
  ctx.adminD = await prisma.user.findUnique({ where: { id: adminD.id } });
  await seedRow({ actorId: ctx.adminD.id, actorRole: "ADMIN", companyId: ctx.companyD.id, action: "CREATED", resource: "USER", createdAt: at(1) });
}, 180000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ companyId: { in: createdCompanyIds } }, { resourceId: { in: createdCompanyIds } }],
    },
  });
  if (ctx.platformRow) {
    await prisma.auditLog.deleteMany({ where: { id: ctx.platformRow.id } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

const superHeaders = () => headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
const adminA = () => headersFor(ctx.adminA.id, ["ADMIN"]);
const headA = () => headersFor(ctx.headA.id, ["HEAD"]);
const memberM1 = () => headersFor(ctx.memberM1.id, ["MEMBER"]);

describe("authorization", () => {
  it("anonymous is rejected", async () => {
    expect((await request(app).get("/api/v1/audit-logs/summary")).status).toBe(401);
  });

  it("CUSTOMER is rejected", async () => {
    const res = await get(headersFor(ctx.customerA.id, ["CUSTOMER"]));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("suspended members are blocked, SUPER_ADMIN reads suspended scopes", async () => {
    const blocked = await get(headersFor(ctx.adminD.id, ["ADMIN"]));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("COMPANY_SUSPENDED");
    const allowed = await get(superHeaders(), `?companyId=${ctx.companyD.id}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.summary.total).toBeGreaterThan(0);
  });

  it("reads mutate nothing", async () => {
    const scope = { OR: [{ companyId: { in: createdCompanyIds } }, { resourceId: { in: createdCompanyIds } }] };
    const before = await prisma.auditLog.count({ where: scope });
    await get(adminA());
    await get(headA());
    await get(memberM1());
    await get(superHeaders());
    expect(await prisma.auditLog.count({ where: scope })).toBe(before);
  });
});

describe("SUPER_ADMIN analytics", () => {
  it("sees platform-wide totals with per-scope correctness", async () => {
    // Narrow to company A so parallel workers' rows cannot interfere.
    // In-window company A rows: 6 seeded + 5 provisioning audits
    // (company-admin, headA, headA2, m1, m2); the 40-day row is out.
    const res = await get(superHeaders(), `?companyId=${ctx.companyA.id}`);
    expect(res.status).toBe(200);
    const summary = res.body.data.summary;
    expect(summary.total).toBe(11);
    expect(summary.byOutcome).toEqual([
      { outcome: "SUCCESS", count: 10 },
      { outcome: "FAILURE", count: 1 },
    ]);
    expect(summary.byAction).toEqual([
      { action: "CREATED", count: 8 },
      { action: "UPDATED", count: 2 },
      { action: "DELETED", count: 1 },
    ]);
    expect(summary.byResource).toEqual([
      { resource: "USER", count: 7 },
      { resource: "CATEGORY", count: 1 },
      { resource: "COUPON", count: 1 },
      { resource: "ORDER", count: 1 },
      { resource: "PRODUCT", count: 1 },
    ]);
    expect(summary.topActors).toContainEqual({ actorId: ctx.memberM1.id, actorRole: "MEMBER", count: 2 });
    expect(summary.topActors).toContainEqual({ actorId: null, actorRole: "SYSTEM", count: 1 });
    expect(summary.topActors).toHaveLength(6);
    expect(summary.recent).toMatchObject({ companyId: ctx.companyA.id });
  });

  it("supports the platform-only null scope", async () => {
    const res = await get(superHeaders(), "?companyId=null");
    expect(res.status).toBe(200);
    expect(res.body.data.summary.total).toBeGreaterThanOrEqual(1);
    // Platform rows exist globally (company lifecycle events); the
    // scope only ever contains null-company rows when filtered so.
    const scoped = await get(superHeaders(), `?companyId=${ctx.companyB.id}&action=CREATED&resource=PRODUCT`);
    expect(scoped.body.data.summary.total).toBe(1);
  });

  it("rejects unknown companies and invalid filters like the read endpoint", async () => {
    const ghost = await get(superHeaders(), "?companyId=11111111-1111-1111-1111-111111111111");
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe("COMPANY_NOT_FOUND");
    for (const query of ["?resource=SPACESHIP", "?action=HACK", "?outcome=MAYBE", "?actorId=nope", "?role=OWNER", "?from=not-a-date"]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await get(superHeaders(), query);
      expect(res.status).toBe(422);
    }
  });
});

describe("ADMIN isolation", () => {
  it("aggregates the own company only", async () => {
    const res = await get(adminA());
    expect(res.status).toBe(200);
    expect(res.body.data.summary.total).toBe(11);
    const actorIds = new Set(res.body.data.summary.topActors.map((a) => a.actorId));
    expect(actorIds.has(ctx.adminB.id)).toBe(false);
    expect(res.body.data.summary.recent.companyId).toBe(ctx.companyA.id);
  });

  it("ignores foreign company parameters without oracles", async () => {
    const res = await get(adminA(), `?companyId=${ctx.companyB.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.summary.total).toBe(11);
  });
});

describe("HEAD visibility", () => {
  it("aggregates self plus members, never peer HEADs", async () => {
    const res = await get(headA());
    expect(res.status).toBe(200);
    const summary = res.body.data.summary;
    // Own seeded row (1) + own-authored member provisions (2) +
    // member-authored rows (3). Peer headA2's DELETED row and every
    // ADMIN-authored row are excluded.
    expect(summary.total).toBe(6);
    const actorIds = new Set(summary.topActors.map((a) => a.actorId));
    expect(actorIds.has(ctx.headA.id)).toBe(true);
    expect(actorIds.has(ctx.memberM1.id)).toBe(true);
    expect(actorIds.has(ctx.headA2.id)).toBe(false);
    expect(actorIds.has(ctx.adminA.id)).toBe(false);
    expect(summary.byAction.some((entry) => entry.action === "DELETED")).toBe(false);
  });

  it("foreign actor parameters change nothing and reveal nothing", async () => {
    const res = await get(headA(), `?actorId=${ctx.headA2.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.summary.total).toBe(6);
  });
});

describe("MEMBER isolation", () => {
  it("aggregates own rows only", async () => {
    const res = await get(memberM1());
    expect(res.status).toBe(200);
    const summary = res.body.data.summary;
    expect(summary.total).toBe(2);
    expect(summary.topActors).toEqual([{ actorId: ctx.memberM1.id, actorRole: "MEMBER", count: 2 }]);
    expect(summary.byAction).toEqual([
      { action: "CREATED", count: 1 },
      { action: "UPDATED", count: 1 },
    ]);
  });

  it("broadening attempts match the read endpoint exactly", async () => {
    // The shared builder treats `role` as a narrowing AND predicate
    // (unlike actorId/companyId, which MEMBER scope forces): no
    // MEMBER-authored ADMIN rows exist, so both surfaces answer zero.
    const query = `?actorId=${ctx.memberM2.id}&companyId=${ctx.companyB.id}&role=ADMIN`;
    const res = await get(memberM1(), query);
    expect(res.status).toBe(200);
    expect(res.body.data.summary.total).toBe(0);
    const list = await request(app).get(`/api/v1/audit-logs${query}`).set(memberM1());
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(0);
  });
});

describe("period handling", () => {
  it("defaults to the trailing 30 days, excluding older rows", async () => {
    const res = await get(superHeaders(), `?companyId=${ctx.companyA.id}`);
    const { period } = res.body.data.summary;
    expect(Date.parse(period.to) - Date.parse(period.from)).toBe(30 * DAY_MS);
    // The 40-day-old row is outside the default window.
    expect(res.body.data.summary.total).toBe(11);
  });

  it("honors explicit bounds inclusively with zero-filled days", async () => {
    const from = new Date(ctx.now - 6 * DAY_MS).toISOString();
    const to = new Date(ctx.now - 4 * DAY_MS).toISOString();
    const res = await get(superHeaders(), `?companyId=${ctx.companyA.id}&from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    const summary = res.body.data.summary;
    // Window covers day-6..day-4: only the day-5 row matches.
    expect(summary.total).toBe(1);
    expect(summary.byDay).toHaveLength(3);
    expect(summary.byDay.map((bucket) => bucket.count)).toEqual([0, 1, 0]);
  });

  it("treats exact from/to instants as inclusive", async () => {
    const at = ctx.row5d.createdAt instanceof Date ? ctx.row5d.createdAt : new Date(ctx.row5d.createdAt);
    const iso = at.toISOString();
    const included = await get(superHeaders(), `?companyId=${ctx.companyA.id}&from=${iso}`);
    expect(included.body.data.summary.total).toBe(11);
    const excluded = await get(
      superHeaders(),
      `?companyId=${ctx.companyA.id}&from=${new Date(at.getTime() + 1).toISOString()}`
    );
    expect(excluded.body.data.summary.total).toBe(10);
    const capped = await get(
      superHeaders(),
      `?companyId=${ctx.companyA.id}&from=${new Date(at.getTime() - 1000).toISOString()}&to=${iso}`
    );
    expect(capped.body.data.summary.total).toBe(1);
    expect(capped.body.data.summary.recent.id).toBe(ctx.row5d.id);
  });

  it("rejects spans over 366 days", async () => {
    const from = new Date(ctx.now - 400 * DAY_MS).toISOString();
    const res = await get(superHeaders(), `?companyId=${ctx.companyA.id}&from=${from}`);
    expect(res.status).toBe(422);
  });

  it("answers empty scopes with zeros, empty buckets, and null recent", async () => {
    const res = await get(superHeaders(), `?resourceId=${randomUUID()}`);
    expect(res.status).toBe(200);
    const summary = res.body.data.summary;
    expect(summary.total).toBe(0);
    expect(summary.byAction).toEqual([]);
    expect(summary.byResource).toEqual([]);
    expect(summary.byOutcome).toEqual([]);
    expect(summary.topActors).toEqual([]);
    expect(summary.recent).toBeNull();
    expect(summary.byDay.length).toBeGreaterThan(0);
    expect(summary.byDay.every((bucket) => bucket.count === 0)).toBe(true);
  });
});

describe("read-contract stability", () => {
  it("list and export endpoints still behave", async () => {
    const list = await request(app).get("/api/v1/audit-logs").set(adminA());
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.logs)).toBe(true);
    const exported = await request(app).get("/api/v1/audit-logs/export").set(adminA());
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toMatch(/^text\/csv/);
  });
});
