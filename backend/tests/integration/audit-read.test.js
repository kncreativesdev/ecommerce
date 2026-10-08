import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin, provisionEmployee } from "../../src/modules/users/users.service.js";
import { recordAuditEvent } from "../../src/modules/audit/audit.service.js";

/**
 * Phase 2C-18 audit-log reads (live HTTP + MySQL).
 *
 * GET /api/v1/audit-logs with hierarchy-aware, server-side visibility:
 * MEMBER own-only, HEAD own+members, ADMIN whole company, SUPER_ADMIN
 * platform + company/actor filters. Company #1 is untouched. Reads are
 * strictly non-mutating (proven by row counts).
 */

const RUN = `TSTAR${Date.now().toString(36).toUpperCase()}`.toLowerCase();

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
      firstName: "AuditRead",
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

async function seedRow({ actorId, actorRole, companyId, action, resource }) {
  return recordAuditEvent({
    actorId,
    actorRole,
    actorEmail: `${RUN}-seed@example.test`,
    companyId,
    action,
    resource,
    resourceId: randomUUID(),
    outcome: "SUCCESS",
    details: { seed: RUN },
  });
}

const get = (headers, query = "") => request(app).get(`/api/v1/audit-logs${query}`).set(headers);

beforeAll(async () => {
  for (const tag of ["a", "b"]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}` } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "AuditRead",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = await prisma.user.findUnique({ where: { id: admin.id } });
  }
  const headA = await provisionEmployee(
    { id: ctx.adminA.id, companyId: ctx.companyA.id, roles: ["ADMIN"] },
    { email: `${RUN}-head-a@example.test`, password: "TestPass123!", firstName: "AuditRead", lastName: "HeadA", role: "HEAD" }
  );
  createdUserIds.push(headA.id);
  ctx.headA = headA;
  for (const tag of ["m1", "m2"]) {
    const member = await provisionEmployee(
      { id: headA.id, companyId: ctx.companyA.id, roles: ["HEAD"] },
      { email: `${RUN}-member-a-${tag}@example.test`, password: "TestPass123!", firstName: "AuditRead", lastName: `Member${tag}`, role: "MEMBER" }
    );
    createdUserIds.push(member.id);
    ctx[`member${tag.toUpperCase()}`] = member;
  }
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);

  // Authored rows per role (member/head/customer-authored activity).
  await seedRow({ actorId: ctx.memberM1.id, actorRole: "MEMBER", companyId: ctx.companyA.id, action: "CREATED", resource: "USER" });
  await seedRow({ actorId: ctx.memberM2.id, actorRole: "MEMBER", companyId: ctx.companyA.id, action: "UPDATED", resource: "PRODUCT" });
  await seedRow({ actorId: ctx.headA.id, actorRole: "HEAD", companyId: ctx.companyA.id, action: "CREATED", resource: "CATEGORY" });
  await seedRow({ actorId: ctx.adminB.id, actorRole: "ADMIN", companyId: ctx.companyB.id, action: "UPDATED", resource: "ORDER" });
  await seedRow({ actorId: ctx.customerA.id, actorRole: "CUSTOMER", companyId: ctx.companyA.id, action: "CREATED", resource: "RETURN" });

  // Real mutation row (category created through the API as adminA).
  const adminHeaders = headersFor(ctx.adminA.id, ["ADMIN"]);
  const category = await request(app).post("/api/v1/categories").set(adminHeaders).send({ name: `${RUN} Cat` });
  expect(category.status).toBe(201);
  ctx.category = category.body.data.category;

  // Suspended company D with its own company-scoped history.
  const superHeaders = headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
  const companyD = await request(app).post("/api/v1/companies").set(superHeaders).send({ name: `${RUN}-co-d` });
  expect(companyD.status).toBe(201);
  createdCompanyIds.push(companyD.body.data.company.id);
  ctx.companyD = companyD.body.data.company;
  const adminD = await provisionCompanyAdmin(ctx.companyD.id, {
    email: `${RUN}-admin-d@example.test`,
    password: "TestPass123!",
    firstName: "AuditRead",
    lastName: "AdminD",
  });
  createdUserIds.push(adminD.id);
  ctx.adminD = await prisma.user.findUnique({ where: { id: adminD.id } });
  const suspended = await request(app).post(`/api/v1/companies/${ctx.companyD.id}/suspend`).set(superHeaders);
  expect(suspended.status).toBe(200);
}, 180000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ companyId: { in: createdCompanyIds } }, { resourceId: { in: createdCompanyIds } }],
    },
  });
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.category.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
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
    expect((await request(app).get("/api/v1/audit-logs")).status).toBe(401);
  });

  it("CUSTOMER is rejected", async () => {
    const res = await get(headersFor(ctx.customerA.id, ["CUSTOMER"]));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("reads mutate nothing", async () => {
    // Scoped to this file's companies/companies' platform rows: the
    // shared database is written by parallel workers, so a global
    // count would be inherently racy.
    const scope = {
      OR: [{ companyId: { in: createdCompanyIds } }, { resourceId: { in: createdCompanyIds } }],
    };
    const before = await prisma.auditLog.count({ where: scope });
    await get(adminA());
    await get(headA());
    await get(memberM1());
    await get(superHeaders());
    expect(await prisma.auditLog.count({ where: scope })).toBe(before);
  });
});

describe("MEMBER isolation", () => {
  it("sees only own rows", async () => {
    const res = await get(memberM1());
    expect(res.status).toBe(200);
    expect(res.body.data.logs.length).toBeGreaterThan(0);
    expect(res.body.data.logs.every((l) => l.actorId === ctx.memberM1.id)).toBe(true);
  });

  it("role broadening returns zero rows, never foreign records", async () => {
    const res = await get(memberM1(), "?role=ADMIN");
    expect(res.status).toBe(200);
    expect(res.body.data.logs).toHaveLength(0);
  });

  it("structured filters cannot escape the self scope", async () => {
    const res = await get(memberM1(), "?resource=USER");
    expect(res.status).toBe(200);
    expect(res.body.data.logs.every((l) => l.actorId === ctx.memberM1.id)).toBe(true);
  });
});

describe("HEAD isolation", () => {
  it("sees own plus member rows, nothing else", async () => {
    const res = await get(headA());
    expect(res.status).toBe(200);
    const actorIds = new Set(res.body.data.logs.map((l) => l.actorId));
    expect(actorIds.has(ctx.headA.id)).toBe(true);
    expect(actorIds.has(ctx.memberM1.id)).toBe(true);
    expect(actorIds.has(ctx.memberM2.id)).toBe(true);
    expect(actorIds.has(ctx.adminA.id)).toBe(false);
    expect(actorIds.has(ctx.adminB.id)).toBe(false);
    expect(res.body.data.logs.every((l) => l.companyId === ctx.companyA.id)).toBe(true);
  });

  it("role=HEAD narrows to own rows (peers excluded)", async () => {
    const res = await get(headA(), "?role=HEAD");
    expect(res.status).toBe(200);
    expect(res.body.data.logs.length).toBeGreaterThan(0);
    expect(res.body.data.logs.every((l) => l.actorId === ctx.headA.id)).toBe(true);
  });

  it("foreign actor and company parameters change nothing", async () => {
    const res = await get(headA(), `?actorId=${ctx.adminA.id}&companyId=${ctx.companyB.id}`);
    expect(res.status).toBe(200);
    const actorIds = new Set(res.body.data.logs.map((l) => l.actorId));
    expect(actorIds.has(ctx.adminA.id)).toBe(false);
    expect(res.body.data.logs.every((l) => l.companyId === ctx.companyA.id)).toBe(true);
  });
});

describe("ADMIN isolation", () => {
  it("sees the whole company, no other company, no platform rows", async () => {
    const res = await get(adminA());
    expect(res.status).toBe(200);
    const actorIds = new Set(res.body.data.logs.map((l) => l.actorId));
    for (const id of [ctx.adminA.id, ctx.headA.id, ctx.memberM1.id, ctx.memberM2.id, ctx.customerA.id]) {
      expect(actorIds.has(id)).toBe(true);
    }
    expect(actorIds.has(ctx.adminB.id)).toBe(false);
    expect(res.body.data.logs.every((l) => l.companyId === ctx.companyA.id)).toBe(true);
    expect(res.body.data.logs.some((l) => l.companyId === null)).toBe(false);
  });

  it("may narrow to an own-company actor", async () => {
    const res = await get(adminA(), `?actorId=${ctx.memberM1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.logs.length).toBeGreaterThan(0);
    expect(res.body.data.logs.every((l) => l.actorId === ctx.memberM1.id)).toBe(true);
  });

  it("foreign actor filter yields empty, never foreign rows", async () => {
    const res = await get(adminA(), `?actorId=${ctx.adminB.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.logs).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });

  it("client companyId cannot move scope, SUPER_ADMIN role filter exposes nothing", async () => {
    const moved = await get(adminA(), `?companyId=${ctx.companyB.id}`);
    expect(moved.status).toBe(200);
    expect(moved.body.data.logs.every((l) => l.companyId === ctx.companyA.id)).toBe(true);
    const elevated = await get(adminA(), "?role=SUPER_ADMIN");
    expect(elevated.status).toBe(200);
    expect(elevated.body.data.logs).toHaveLength(0);
  });
});

describe("SUPER_ADMIN platform and company reads", () => {
  it("sees platform, company A, and company B rows", async () => {
    // Filtered reads (the unfiltered first page is shared-global and
    // paged, so presence there is load-dependent by design).
    for (const [query, expected] of [
      [`?companyId=${ctx.companyA.id}`, ctx.companyA.id],
      [`?companyId=${ctx.companyB.id}`, ctx.companyB.id],
      ["?companyId=null", null],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await get(superHeaders(), query);
      expect(res.status).toBe(200);
      expect(res.body.data.logs.length).toBeGreaterThan(0);
      expect(res.body.data.logs.every((l) => l.companyId === expected)).toBe(true);
    }
  });

  it("company filter scopes, null selects platform-only", async () => {
    const scoped = await get(superHeaders(), `?companyId=${ctx.companyA.id}`);
    expect(scoped.status).toBe(200);
    expect(scoped.body.data.logs.length).toBeGreaterThan(0);
    expect(scoped.body.data.logs.every((l) => l.companyId === ctx.companyA.id)).toBe(true);
    const platform = await get(superHeaders(), "?companyId=null");
    expect(platform.status).toBe(200);
    expect(platform.body.data.logs.length).toBeGreaterThan(0);
    expect(platform.body.data.logs.every((l) => l.companyId === null)).toBe(true);
  });

  it("unknown company 404s, malformed company 422s", async () => {
    const ghost = await get(superHeaders(), "?companyId=11111111-1111-1111-1111-111111111111");
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe("COMPANY_NOT_FOUND");
    const malformed = await get(superHeaders(), "?companyId=not-a-uuid");
    expect(malformed.status).toBe(422);
  });

  it("actor filter works, including actor+company combinations", async () => {
    const byActor = await get(superHeaders(), `?actorId=${ctx.headA.id}`);
    expect(byActor.status).toBe(200);
    expect(byActor.body.data.logs.every((l) => l.actorId === ctx.headA.id)).toBe(true);
    const combo = await get(superHeaders(), `?actorId=${ctx.headA.id}&companyId=${ctx.companyB.id}`);
    expect(combo.status).toBe(200);
    expect(combo.body.data.logs).toHaveLength(0);
  });

  it("suspended company logs remain readable", async () => {
    const res = await get(superHeaders(), `?companyId=${ctx.companyD.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.logs.length).toBeGreaterThan(0);
    expect(res.body.data.logs.every((l) => l.companyId === ctx.companyD.id)).toBe(true);
    // The company's own provisioning history (SYSTEM-authored,
    // resourceId = the designated ADMIN) stays inspectable.
    expect(res.body.data.logs.some((l) => l.resourceId === ctx.adminD.id)).toBe(true);
  });

  it("suspended members cannot read (no suspension bypass)", async () => {
    const res = await get(headersFor(ctx.adminD.id, ["ADMIN"]));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
  });
});

describe("filters, pagination, projection", () => {
  it("resource/action/outcome filters apply", async () => {
    const resource = await get(adminA(), "?resource=CATEGORY");
    expect(resource.status).toBe(200);
    expect(resource.body.data.logs.every((l) => l.resource === "CATEGORY")).toBe(true);
    const action = await get(adminA(), "?action=CREATED");
    expect(action.status).toBe(200);
    expect(action.body.data.logs.every((l) => l.action === "CREATED")).toBe(true);
    const outcome = await get(adminA(), "?outcome=SUCCESS");
    expect(outcome.status).toBe(200);
    expect(outcome.body.data.logs.every((l) => l.outcome === "SUCCESS")).toBe(true);
  });

  it("invalid filters 422 without querying", async () => {
    for (const query of ["?resource=SPACESHIP", "?action=HACK", "?outcome=MAYBE", "?actorId=nope", "?role=OWNER"]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await get(adminA(), query);
      expect(res.status).toBe(422);
    }
    const dates = await get(adminA(), "?from=not-a-date");
    expect(dates.status).toBe(422);
  });

  it("date range bounds inclusively", async () => {
    const future = await get(adminA(), `?from=${new Date(Date.now() + 86400000).toISOString()}`);
    expect(future.status).toBe(200);
    expect(future.body.data.logs).toHaveLength(0);
    const past = await get(adminA(), "?from=2000-01-01T00:00:00.000Z");
    expect(past.status).toBe(200);
    expect(past.body.data.logs.length).toBeGreaterThan(0);
  });

  it("pagination defaults, caps, pages, and orders newest-first", async () => {
    const first = await request(app).post("/api/v1/categories").set(adminA()).send({ name: `${RUN} Page One` });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/v1/categories").set(adminA()).send({ name: `${RUN} Page Two` });
    expect(second.status).toBe(201);
    const def = await get(adminA(), `?resource=CATEGORY&actorId=${ctx.adminA.id}`);
    expect(def.status).toBe(200);
    expect(def.body.meta).toMatchObject({ page: 1, limit: 20 });
    const ids = def.body.data.logs.map((l) => l.resourceId);
    expect(ids.indexOf(second.body.data.category.id)).toBeLessThan(ids.indexOf(first.body.data.category.id));
    const clamped = await get(adminA(), "?limit=100");
    expect(clamped.status).toBe(200);
    expect(clamped.body.meta.limit).toBe(100);
    const over = await get(adminA(), "?limit=101");
    expect(over.status).toBe(422);
    const empty = await get(adminA(), "?page=99999");
    expect(empty.status).toBe(200);
    expect(empty.body.data.logs).toHaveLength(0);
    expect(empty.body.meta.page).toBe(99999);
  });

  it("projection exposes safe fields only", async () => {
    const res = await get(adminA(), "?limit=1");
    expect(res.status).toBe(200);
    const row = res.body.data.logs[0];
    expect(Object.keys(row).sort()).toEqual(
      ["action", "actorEmail", "actorId", "actorRole", "companyId", "createdAt", "details", "id", "outcome", "resource", "resourceId"].sort()
    );
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refreshToken|otp/i);
  });
});
