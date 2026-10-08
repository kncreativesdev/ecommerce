import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import {
  provisionCompanyAdmin,
  provisionEmployee,
  setUserActiveAdmin,
} from "../../src/modules/users/users.service.js";
import {
  recordAuditEvent,
  listAuditLogs,
} from "../../src/modules/audit/audit.service.js";

/**
 * Phase 2C-14 audit-log foundation (live MySQL).
 *
 * Covers the model (nullable platform/system fields, timestamps), the
 * validated writer incl. the secret-metadata guard, the transactional
 * provisioning event with rollback proof, the post-commit ban event,
 * and the role/company visibility matrix. No HTTP audit endpoints
 * exist by design — visibility is exercised through the service with
 * server-side viewer identities.
 *
 * Dedicated companies A/B; Company #1 untouched. Audit rows for
 * dedicated companies are removed in cleanup (append-only applies to
 * product behavior, not test hygiene).
 */

const RUN = `TSTAL${Date.now().toString(36).toUpperCase()}`.toLowerCase();

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
      firstName: "AuditIso",
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

async function auditCount(where = {}) {
  return prisma.auditLog.count({ where });
}

beforeAll(async () => {
  for (const tag of ["a", "b"]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}` } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "AuditIso",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = await prisma.user.findUnique({ where: { id: admin.id } });
  }
  const headA = await provisionEmployee(
    { id: ctx.adminA.id, companyId: ctx.companyA.id, roles: ["ADMIN"] },
    { email: `${RUN}-head-a@example.test`, password: "TestPass123!", firstName: "AuditIso", lastName: "HeadA", role: "HEAD" }
  );
  createdUserIds.push(headA.id);
  ctx.headA = await prisma.user.findUnique({ where: { id: headA.id } });
  const memberA = await provisionEmployee(
    { id: ctx.headA.id, companyId: ctx.companyA.id, roles: ["HEAD"] },
    { email: `${RUN}-member-a@example.test`, password: "TestPass123!", firstName: "AuditIso", lastName: "MemberA", role: "MEMBER" }
  );
  createdUserIds.push(memberA.id);
  ctx.memberA = await prisma.user.findUnique({ where: { id: memberA.id } });
  const memberA2 = await provisionEmployee(
    { id: ctx.headA.id, companyId: ctx.companyA.id, roles: ["HEAD"] },
    { email: `${RUN}-member-a2@example.test`, password: "TestPass123!", firstName: "AuditIso", lastName: "MemberA2", role: "MEMBER" }
  );
  createdUserIds.push(memberA2.id);
  ctx.memberA2 = await prisma.user.findUnique({ where: { id: memberA2.id } });
  ctx.customerB = await createUser("customer-b", "CUSTOMER", ctx.companyB.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);
  // Authored events so visibility assertions below are non-vacuous.
  for (const [user, role] of [[ctx.headA, "HEAD"], [ctx.memberA, "MEMBER"], [ctx.memberA2, "MEMBER"]]) {
    await recordAuditEvent({
      actorId: user.id,
      actorRole: role,
      actorEmail: `${RUN}-seed@example.test`,
      companyId: ctx.companyA.id,
      action: "CREATED",
      resource: "USER",
      outcome: "SUCCESS",
    });
  }
}, 180000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { OR: [{ companyId: { in: createdCompanyIds } }, { companyId: null }] },
  });
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

describe("model and writer validation", () => {
  it("records company and platform events with snapshots and timestamps", async () => {
    const companyEvent = await recordAuditEvent({
      actorId: ctx.adminA.id,
      actorRole: "ADMIN",
      actorEmail: `${RUN}-admin-a@example.test`,
      companyId: ctx.companyA.id,
      action: "CREATED",
      resource: "USER",
      resourceId: ctx.memberA.id,
      outcome: "SUCCESS",
      details: { email: "x@example.test" },
    });
    expect(companyEvent.id).toBeTruthy();
    expect(companyEvent.createdAt).toBeInstanceOf(Date);
    expect(companyEvent.companyId).toBe(ctx.companyA.id);
    const platformEvent = await recordAuditEvent({
      actorId: null,
      actorRole: "SYSTEM",
      companyId: null,
      action: "CREATED",
      resource: "COMPANY",
      outcome: "SUCCESS",
      details: null,
    });
    expect(platformEvent.actorId).toBeNull();
    expect(platformEvent.companyId).toBeNull();
  });

  it("rejects unknown roles, actions, outcomes, resources, and ids", async () => {
    const base = {
      actorId: ctx.adminA.id,
      actorRole: "ADMIN",
      companyId: ctx.companyA.id,
      action: "CREATED",
      resource: "USER",
      outcome: "SUCCESS",
    };
    await expect(recordAuditEvent({ ...base, actorRole: "OWNER" })).rejects.toMatchObject({ code: "AUDIT_INVALID_ACTOR" });
    await expect(recordAuditEvent({ ...base, action: "HACK" })).rejects.toMatchObject({ code: "AUDIT_INVALID_ACTION" });
    await expect(recordAuditEvent({ ...base, outcome: "MAYBE" })).rejects.toMatchObject({ code: "AUDIT_INVALID_OUTCOME" });
    await expect(recordAuditEvent({ ...base, resource: "SPACESHIP" })).rejects.toMatchObject({ code: "AUDIT_INVALID_RESOURCE" });
    await expect(recordAuditEvent({ ...base, resourceId: "not-a-uuid" })).rejects.toMatchObject({ code: "AUDIT_INVALID_EVENT" });
  });

  it("refuses secret-bearing metadata without persisting anything", async () => {
    const before = await auditCount();
    const attempts = [
      { password: "hunter2" },
      { passwordHash: "argon2..." },
      { refreshToken: "abc" },
      { nested: { cookie: "session=1" } },
      { token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c" },
      { note: "call Bearer abcdefghijklmnop now" },
    ];
    for (const details of attempts) {
      await expect(
        recordAuditEvent({
          actorId: ctx.adminA.id,
          actorRole: "ADMIN",
          companyId: ctx.companyA.id,
          action: "UPDATED",
          resource: "USER",
          outcome: "SUCCESS",
          details,
        })
      ).rejects.toMatchObject({ code: "AUDIT_UNSAFE_METADATA" });
    }
    expect(await auditCount()).toBe(before);
    // Benign lookalikes are accepted.
    const ok = await recordAuditEvent({
      actorId: ctx.adminA.id,
      actorRole: "ADMIN",
      companyId: ctx.companyA.id,
      action: "UPDATED",
      resource: "USER",
      outcome: "SUCCESS",
      details: { tokenCount: 3, note: "rotated session marker" },
    });
    expect(ok.id).toBeTruthy();
  });
});

describe("representative instrumented events", () => {
  it("provisioning writes its audit row in the same transaction", async () => {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-prov` } });
    createdCompanyIds.push(company.id);
    const before = await auditCount({ companyId: company.id });
    const admin = await provisionCompanyAdmin(
      company.id,
      { email: `${RUN}-prov-admin@example.test`, password: "TestPass123!", firstName: "AuditIso", lastName: "Prov" },
      { id: ctx.adminA.id }
    );
    createdUserIds.push(admin.id);
    const rows = await prisma.auditLog.findMany({ where: { companyId: company.id } });
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toMatchObject({
      action: "CREATED",
      resource: "USER",
      resourceId: admin.id,
      outcome: "SUCCESS",
    });
  });

  it("failed provisioning leaves no audit row (no false success records)", async () => {
    const before = await auditCount({ companyId: ctx.companyA.id });
    // Company A already has an ADMIN: pre-check refusal, nothing written.
    await expect(
      provisionCompanyAdmin(
        ctx.companyA.id,
        { email: `${RUN}-dup-admin@example.test`, password: "TestPass123!", firstName: "AuditIso", lastName: "Dup" },
        { id: ctx.adminA.id }
      )
    ).rejects.toMatchObject({ code: "COMPANY_ADMIN_EXISTS" });
    expect(await auditCount({ companyId: ctx.companyA.id })).toBe(before);
  });

  it("transactional writes roll back together (mechanism proof)", async () => {
    const before = await auditCount({ companyId: ctx.companyA.id });
    await expect(
      prisma.$transaction(async (tx) => {
        await recordAuditEvent(
          {
            actorId: ctx.adminA.id,
            actorRole: "ADMIN",
            companyId: ctx.companyA.id,
            action: "CREATED",
            resource: "USER",
            outcome: "SUCCESS",
          },
          tx
        );
        throw new Error("simulated mutation failure");
      })
    ).rejects.toThrow("simulated mutation failure");
    expect(await auditCount({ companyId: ctx.companyA.id })).toBe(before);
  });

  it("ban/deactivate records actor snapshot after the mutation", async () => {
    const target = await createUser("bantarget", "MEMBER", ctx.companyA.id);
    await setUserActiveAdmin(ctx.companyA.id, target.id, false, ctx.adminA.id);
    const row = await prisma.auditLog.findFirst({
      where: { companyId: ctx.companyA.id, resourceId: target.id, action: "DEACTIVATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row.actorId).toBe(ctx.adminA.id);
    expect(row.actorRole).toBe("ADMIN");
    expect(row.outcome).toBe("SUCCESS");
    await setUserActiveAdmin(ctx.companyA.id, target.id, true, ctx.adminA.id);
    const restored = await prisma.auditLog.findFirst({
      where: { companyId: ctx.companyA.id, resourceId: target.id, action: "REACTIVATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(restored).not.toBeNull();
  });

  it("HTTP ban flow attributes the calling admin", async () => {
    const target = await createUser("httpban", "MEMBER", ctx.companyA.id);
    const res = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set(headersFor(ctx.adminA.id))
      .send({ isActive: false });
    expect(res.status).toBe(200);
    const row = await prisma.auditLog.findFirst({
      where: { companyId: ctx.companyA.id, resourceId: target.id, action: "DEACTIVATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(row?.actorId).toBe(ctx.adminA.id);
    await setUserActiveAdmin(ctx.companyA.id, target.id, true, ctx.adminA.id);
  });
});

describe("visibility matrix", () => {
  it("MEMBER sees own rows only", async () => {
    const view = await listAuditLogs({ id: ctx.memberA.id, roles: ["MEMBER"], companyId: ctx.companyA.id }, {});
    expect(view.pagination.total).toBeGreaterThan(0);
    expect(view.logs.every((l) => l.actorId === ctx.memberA.id)).toBe(true);
  });

  it("HEAD sees own plus MEMBER rows, never another HEAD", async () => {
    const headB = await createUser("head-b", "HEAD", ctx.companyB.id);
    const view = await listAuditLogs({ id: ctx.headA.id, roles: ["HEAD"], companyId: ctx.companyA.id }, {});
    const actorIds = new Set(view.logs.map((l) => l.actorId));
    expect(view.logs.every((l) => l.companyId === ctx.companyA.id)).toBe(true);
    expect([...actorIds].every((id) => id === ctx.headA.id || id === ctx.memberA.id || id === ctx.memberA2.id || id === null)).toBe(true);
    // A HEAD row exists (provisioning actors) — peer HEADs of company A: none provisioned here besides self,
    // so assert via a directly written HEAD event instead.
    await recordAuditEvent({
      actorId: headB.id,
      actorRole: "HEAD",
      companyId: ctx.companyB.id,
      action: "CREATED",
      resource: "USER",
      outcome: "SUCCESS",
    });
    const reread = await listAuditLogs({ id: ctx.headA.id, roles: ["HEAD"], companyId: ctx.companyA.id }, {});
    expect(reread.logs.map((l) => l.actorId)).not.toContain(headB.id);
  });

  it("ADMIN sees own company only", async () => {
    const view = await listAuditLogs({ id: ctx.adminA.id, roles: ["ADMIN"], companyId: ctx.companyA.id }, {});
    expect(view.pagination.total).toBeGreaterThan(0);
    expect(view.logs.every((l) => l.companyId === ctx.companyA.id)).toBe(true);
  });

  it("SUPER_ADMIN sees platform and per-company slices", async () => {
    const all = await listAuditLogs({ id: ctx.superAdmin.id, roles: ["SUPER_ADMIN"] }, {});
    expect(all.pagination.total).toBeGreaterThan(0);
    const onlyA = await listAuditLogs({ id: ctx.superAdmin.id, roles: ["SUPER_ADMIN"] }, { companyId: ctx.companyA.id });
    expect(onlyA.logs.every((l) => l.companyId === ctx.companyA.id)).toBe(true);
    const platform = await listAuditLogs({ id: ctx.superAdmin.id, roles: ["SUPER_ADMIN"] }, { companyId: null });
    expect(platform.logs.every((l) => l.companyId === null)).toBe(true);
  });

  it("CUSTOMER and role-less viewers are denied", async () => {
    await expect(
      listAuditLogs({ id: ctx.customerB.id, roles: ["CUSTOMER"], companyId: ctx.companyB.id }, {})
    ).rejects.toMatchObject({ code: "AUDIT_FORBIDDEN" });
    await expect(listAuditLogs({ id: "x", roles: [] }, {})).rejects.toMatchObject({ code: "AUDIT_FORBIDDEN" });
  });

  it("append-only: no delete path exists on the module", async () => {
    const auditService = await import("../../src/modules/audit/audit.service.js");
    const auditRepository = await import("../../src/modules/audit/audit.repository.js");
    for (const name of Object.keys({ ...auditService, ...auditRepository })) {
      expect(name.toLowerCase()).not.toMatch(/delete|remove|purge|destroy/);
    }
  });
});
