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
 * Audit actor-role hierarchy (security regression).
 *
 * Rows whose `actorRole` snapshot is SUPER_ADMIN are visible ONLY to
 * SUPER_ADMIN viewers — never to ADMIN/HEAD/MEMBER, even when the
 * row's `companyId` equals the viewer's company (e.g. a SUPER_ADMIN
 * provisioning that company's ADMIN). Company/actor/member scoping
 * rules for staff-authored rows are otherwise unchanged.
 */

const RUN = `TSTAH${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const SEED = (tag) => `${RUN}-${tag}`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];
const createdResourceIds = [];

const headersFor = (id, roles) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "AuditHier",
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

async function seedRow({ actorId, actorRole, companyId, action, resource, tag }) {
  const resourceId = randomUUID();
  createdResourceIds.push(resourceId);
  return recordAuditEvent({
    actorId,
    actorRole,
    actorEmail: `${RUN}-${tag}@example.test`,
    companyId,
    action,
    resource,
    resourceId,
    outcome: "SUCCESS",
    details: { seed: RUN, tag },
  });
}

const get = (headers, query = "") => request(app).get(`/api/v1/audit-logs${query}`).set(headers);

beforeAll(async () => {
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);

  // Company A: full staff ladder.
  const companyA = await prisma.company.create({ data: { name: `${RUN}-co-a` } });
  createdCompanyIds.push(companyA.id);
  ctx.companyA = companyA;
  const adminA = await provisionCompanyAdmin(companyA.id, {
    email: `${RUN}-admin-a@example.test`,
    password: "TestPass123!",
    firstName: "AuditHier",
    lastName: "AdminA",
  });
  createdUserIds.push(adminA.id);
  ctx.adminA = await prisma.user.findUnique({ where: { id: adminA.id } });
  ctx.headA = await provisionEmployee(
    { id: ctx.adminA.id, companyId: companyA.id, roles: ["ADMIN"] },
    { email: `${RUN}-head-a@example.test`, password: "TestPass123!", firstName: "AuditHier", lastName: "HeadA", role: "HEAD" }
  );
  createdUserIds.push(ctx.headA.id);
  ctx.headA2 = await provisionEmployee(
    { id: ctx.adminA.id, companyId: companyA.id, roles: ["ADMIN"] },
    { email: `${RUN}-head-a2@example.test`, password: "TestPass123!", firstName: "AuditHier", lastName: "HeadA2", role: "HEAD" }
  );
  createdUserIds.push(ctx.headA2.id);
  ctx.memberA = await provisionEmployee(
    { id: ctx.headA.id, companyId: companyA.id, roles: ["HEAD"] },
    { email: `${RUN}-member-a@example.test`, password: "TestPass123!", firstName: "AuditHier", lastName: "MemberA", role: "MEMBER" }
  );
  createdUserIds.push(ctx.memberA.id);
  ctx.customerA = await createUser("customer-a", "CUSTOMER", companyA.id);

  // The reported bug, end to end through the real API: SUPER_ADMIN
  // creates Company C and provisions its ADMIN. Both writes emit
  // SUPER_ADMIN-snapshot audit rows (platform + company-scoped).
  const superHeaders = headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
  const companyC = await request(app).post("/api/v1/companies").set(superHeaders).send({ name: `${RUN}-co-c` });
  expect(companyC.status).toBe(201);
  createdCompanyIds.push(companyC.body.data.company.id);
  ctx.companyC = companyC.body.data.company;
  const provisioned = await request(app).post(`/api/v1/companies/${ctx.companyC.id}/admin`).set(superHeaders).send({
    email: `${RUN}-admin-c@example.test`,
    password: "TestPass123!",
    firstName: "AuditHier",
    lastName: "AdminC",
  });
  expect(provisioned.status).toBe(201);
  createdUserIds.push(provisioned.body.data.admin.id);
  ctx.adminC = await prisma.user.findUnique({ where: { id: provisioned.body.data.admin.id } });

  // Deterministic seeded pair for Company A: event A carries a
  // SUPER_ADMIN snapshot scoped to A; event B an ADMIN snapshot.
  // Same company, different actor roles — the filter must split on
  // role, not on companyId alone.
  ctx.eventA = await seedRow({
    actorId: ctx.superAdmin.id, actorRole: "SUPER_ADMIN", companyId: companyA.id,
    action: "CREATED", resource: "COMPANY", tag: "super-a",
  });
  ctx.eventB = await seedRow({
    actorId: ctx.adminA.id, actorRole: "ADMIN", companyId: companyA.id,
    action: "UPDATED", resource: "USER", tag: "admin-a",
  });
  // SUPER_ADMIN snapshot with NULL company (platform row) + staff rows.
  ctx.eventPlatform = await seedRow({
    actorId: ctx.superAdmin.id, actorRole: "SUPER_ADMIN", companyId: null,
    action: "CREATED", resource: "COMPANY", tag: "super-platform",
  });
  ctx.eventHead = await seedRow({
    actorId: ctx.headA.id, actorRole: "HEAD", companyId: companyA.id,
    action: "CREATED", resource: "CATEGORY", tag: "head-a",
  });
  ctx.eventMember = await seedRow({
    actorId: ctx.memberA.id, actorRole: "MEMBER", companyId: companyA.id,
    action: "UPDATED", resource: "PRODUCT", tag: "member-a",
  });
}, 180000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ companyId: { in: createdCompanyIds } }, { resourceId: { in: createdResourceIds } }],
    },
  });
  // Platform SUPER_ADMIN rows created by this file carry companyId
  // NULL; remove them by their unique seeded actor email instead.
  await prisma.auditLog.deleteMany({ where: { actorEmail: { contains: RUN } } });
  if (createdUserIds.length > 0) {
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
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
const memberA = () => headersFor(ctx.memberA.id, ["MEMBER"]);

function idsOf(body) {
  return (body.data.logs || []).map((row) => row.id);
}

describe("SUPER_ADMIN snapshots are invisible to company staff", () => {
  it("ADMIN sees the ADMIN event but not the same-company SUPER_ADMIN event (list)", async () => {
    const res = await get(adminA());
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(ctx.eventB.id);
    expect(ids).not.toContain(ctx.eventA.id);
    expect(ids).not.toContain(ctx.eventPlatform.id);
    for (const row of res.body.data.logs) {
      expect(row.actorRole).not.toBe("SUPER_ADMIN");
    }
  });

  it("ADMIN pagination totals exclude SUPER_ADMIN rows and carry no empty slots", async () => {
    const res = await get(adminA(), "?limit=100");
    expect(res.status).toBe(200);
    // Visible set for ADMIN A: every company-A row except SUPER_ADMIN
    // snapshots (eventB + head + member rows authored above).
    const expected = await prisma.auditLog.count({
      where: { companyId: ctx.companyA.id, actorRole: { not: "SUPER_ADMIN" } },
    });
    expect(res.body.meta.total).toBe(expected);
    expect(res.body.data.logs.length).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("HEAD and MEMBER never see SUPER_ADMIN snapshots", async () => {
    for (const headers of [headA(), memberA()]) {
      const res = await get(headers);
      expect(res.status).toBe(200);
      for (const row of res.body.data.logs) {
        expect(row.actorRole).not.toBe("SUPER_ADMIN");
      }
      expect(idsOf(res.body)).not.toContain(ctx.eventA.id);
    }
  });

  it("CUSTOMER remains denied", async () => {
    const res = await get(headersFor(ctx.customerA.id, ["CUSTOMER"]));
    expect(res.status).toBe(403);
  });

  it("ADMIN summary excludes SUPER_ADMIN events from every metric", async () => {
    const res = await request(app).get("/api/v1/audit-logs/summary").set(adminA());
    expect(res.status).toBe(200);
    const summary = res.body.data.summary;
    const expected = await prisma.auditLog.count({
      where: { companyId: ctx.companyA.id, actorRole: { not: "SUPER_ADMIN" } },
    });
    expect(summary.total).toBe(expected);
    for (const actor of summary.topActors) {
      expect(actor.actorRole).not.toBe("SUPER_ADMIN");
    }
    expect((summary.recent?.actorRole ?? null)).not.toBe("SUPER_ADMIN");
  });

  it("ADMIN export contains zero SUPER_ADMIN rows", async () => {
    const res = await request(app).get("/api/v1/audit-logs/export").set(adminA());
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    // Seeded SUPER_ADMIN markers (actor email + resource ids) absent;
    // the ADMIN-authored marker present.
    expect(res.text).not.toContain(`${RUN}-super-a@example.test`);
    expect(res.text).not.toContain(`${RUN}-super-platform@example.test`);
    expect(res.text).not.toContain(ctx.eventA.id);
    expect(res.text).toContain(`${RUN}-admin-a@example.test`);
  });
});

describe("end-to-end reported flow stays hidden from the new ADMIN", () => {
  it("ADMIN C cannot see the SUPER_ADMIN rows that created its company/admin", async () => {
    const adminC = headersFor(ctx.adminC.id, ["ADMIN"]);
    const res = await get(adminC);
    expect(res.status).toBe(200);
    for (const row of res.body.data.logs) {
      expect(row.actorRole).not.toBe("SUPER_ADMIN");
    }
    const summary = await request(app).get("/api/v1/audit-logs/summary").set(adminC);
    expect(summary.status).toBe(200);
    for (const actor of summary.body.data.summary.topActors) {
      expect(actor.actorRole).not.toBe("SUPER_ADMIN");
    }
    const exported = await request(app).get("/api/v1/audit-logs/export").set(adminC);
    expect(exported.status).toBe(200);
    expect(exported.text).not.toContain(ctx.superAdmin.id);
  });
});

describe("existing visibility rules are otherwise intact", () => {
  it("ADMIN still sees company staff activity", async () => {
    const res = await get(adminA());
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(ctx.eventB.id);
    expect(ids).toContain(ctx.eventHead.id);
    expect(ids).toContain(ctx.eventMember.id);
  });

  it("HEAD still sees own + member rows, not peer HEAD rows", async () => {
    const res = await get(headA());
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(ctx.eventHead.id);
    expect(ids).toContain(ctx.eventMember.id);
    // Peer HEAD (headA2) authored nothing; HEAD scope is self+members.
    for (const row of res.body.data.logs) {
      expect(["HEAD", "MEMBER"]).toContain(row.actorRole);
    }
  });

  it("MEMBER still sees own rows only", async () => {
    const res = await get(memberA());
    expect(res.status).toBe(200);
    expect(res.body.data.logs.length).toBeGreaterThan(0);
    for (const row of res.body.data.logs) {
      expect(row.actorId).toBe(ctx.memberA.id);
    }
  });

  it("SUPER_ADMIN visibility is unchanged (platform + company rows)", async () => {
    const res = await get(superHeaders());
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(ctx.eventA.id);
    expect(ids).toContain(ctx.eventB.id);
    expect(ids).toContain(ctx.eventPlatform.id);
    const summary = await request(app).get("/api/v1/audit-logs/summary").set(superHeaders());
    expect(summary.status).toBe(200);
    expect(summary.body.data.summary.total).toBeGreaterThan(0);
    const exported = await request(app).get("/api/v1/audit-logs/export").set(superHeaders());
    expect(exported.status).toBe(200);
    expect(exported.text).toContain(`${RUN}-super-a@example.test`);
  });
});
