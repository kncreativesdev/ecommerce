import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { runRetentionCleanup } from "../../src/modules/audit/retention.service.js";

/**
 * Phase 2C-19 audit retention policy + cleanup (live HTTP + MySQL).
 *
 * Global NEVER/30_DAYS/1_YEAR policy, SUPER_ADMIN-only API, audited
 * changes, and server-side age-based purge with strict-older cutoff
 * semantics. No manual delete endpoint exists (proven 404).
 */

const RUN = `TSTRT${Date.now().toString(36).toUpperCase()}`.toLowerCase();
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
      firstName: "Retain",
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

async function seedAuditRow(ageMs, extra = {}) {
  return prisma.auditLog.create({
    data: {
      actorId: null,
      actorRole: "SYSTEM",
      actorEmail: null,
      companyId: ctx.company.id,
      action: "CREATED",
      resource: "USER",
      resourceId: null,
      outcome: "SUCCESS",
      details: { seed: RUN },
      createdAt: new Date(Date.now() - ageMs),
      ...extra,
    },
  });
}

const superHeaders = () => headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
const getPolicy = (headers, query = "") => request(app).get(`/api/v1/audit-retention${query}`).set(headers);
const patchPolicy = (headers, body) => request(app).patch("/api/v1/audit-retention").set(headers).send(body);

beforeAll(async () => {
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);
  const company = await prisma.company.create({ data: { name: `${RUN}-co` } });
  createdCompanyIds.push(company.id);
  ctx.company = company;
  for (const [tag, role] of [["admin", "ADMIN"], ["head", "HEAD"], ["member", "MEMBER"], ["customer", "CUSTOMER"]]) {
    ctx[tag] = await createUser(`denied-${tag}`, role, company.id);
  }
  const suspended = await prisma.company.create({ data: { name: `${RUN}-suspended-co`, status: "SUSPENDED" } });
  createdCompanyIds.push(suspended.id);
  ctx.suspendedCompany = suspended;
  // Fresh-default precondition: no policy row exists yet in this run.
  await prisma.auditRetentionPolicy.deleteMany({});
}, 120000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await prisma.auditLog.deleteMany({ where: { resource: "AUDIT_RETENTION", actorId: { in: createdUserIds } } });
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  // Leave the platform in its default state for later runs.
  await prisma.auditRetentionPolicy.deleteMany({});
  await prisma.$disconnect();
});

describe("authorization", () => {
  it("anonymous is rejected", async () => {
    expect((await request(app).get("/api/v1/audit-retention")).status).toBe(401);
    expect((await request(app).patch("/api/v1/audit-retention").send({ policy: "NEVER" })).status).toBe(401);
  });

  it.each([["ADMIN", "admin"], ["HEAD", "head"], ["MEMBER", "member"], ["CUSTOMER", "customer"]])(
    "%s cannot read or modify",
    async (_role, tag) => {
      const roles = { ADMIN: ["ADMIN"], HEAD: ["HEAD"], MEMBER: ["MEMBER"], CUSTOMER: ["CUSTOMER"] }[_role];
      const headers = headersFor(ctx[tag].id, roles);
      expect((await getPolicy(headers)).status).toBe(403);
      expect((await patchPolicy(headers, { policy: "NEVER" })).status).toBe(403);
    }
  );

  it("SUPER_ADMIN reads the fresh default NEVER", async () => {
    const res = await getPolicy(superHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.retention).toMatchObject({
      policy: "NEVER",
      description: "Audit logs are retained indefinitely.",
      updatedAt: null,
      updatedBy: null,
    });
  });
});

describe("validation", () => {
  it("accepts exactly the supported enum", async () => {
    for (const policy of ["NEVER", "30_DAYS", "1_YEAR"]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await patchPolicy(superHeaders(), { policy });
      expect(res.status).toBe(200);
      expect(res.body.data.retention.policy).toBe(policy);
    }
    // Restore the default for the phases below.
    expect((await patchPolicy(superHeaders(), { policy: "NEVER" })).status).toBe(200);
  });

  it("rejects everything else", async () => {
    for (const body of [
      { policy: "17_DAYS" },
      { policy: "forever" },
      { policy: "" },
      { policy: 30 },
      { policy: null },
      { retentionDays: 17 },
      { policy: "NEVER", companyId: ctx.company.id },
      { policy: "NEVER", retentionMonths: 3 },
      {},
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await patchPolicy(superHeaders(), body);
      expect(res.status).toBe(422);
    }
  });
});

describe("transitions and audit", () => {
  it("NEVER → 30_DAYS → 1_YEAR → NEVER with idempotent same-value updates", async () => {
    const first = await patchPolicy(superHeaders(), { policy: "30_DAYS" });
    expect(first.status).toBe(200);
    expect(first.body.data.retention).toMatchObject({
      policy: "30_DAYS",
      description: "Audit logs are deleted after 30 days.",
      updatedBy: ctx.superAdmin.id,
      changed: true,
    });
    const same = await patchPolicy(superHeaders(), { policy: "30_DAYS" });
    expect(same.status).toBe(200);
    expect(same.body.data.retention.changed).toBe(false);
    expect((await patchPolicy(superHeaders(), { policy: "1_YEAR" })).body.data.retention.policy).toBe("1_YEAR");
    const back = await patchPolicy(superHeaders(), { policy: "NEVER" });
    expect(back.body.data.retention).toMatchObject({
      policy: "NEVER",
      description: "Audit logs are retained indefinitely.",
      changed: true,
    });
  });

  it("every change writes exactly one secret-free platform audit", async () => {
    // Scoped to this run's SUPER_ADMIN (actor ids are RUN-unique):
    // other files never write AUDIT_RETENTION rows, but their
    // platform-row cleanup must not disturb this assertion either.
    const rows = await prisma.auditLog.findMany({
      where: { resource: "AUDIT_RETENTION", actorId: ctx.superAdmin.id },
      orderBy: [{ createdAt: "asc" }],
    });
    // Validation phase (NEVER same-value writes nothing; 30_DAYS,
    // 1_YEAR, NEVER) + transitions (30_DAYS, 1_YEAR, NEVER).
    expect(rows).toHaveLength(6);
    const chain = [
      ["NEVER", "30_DAYS"],
      ["30_DAYS", "1_YEAR"],
      ["1_YEAR", "NEVER"],
      ["NEVER", "30_DAYS"],
      ["30_DAYS", "1_YEAR"],
      ["1_YEAR", "NEVER"],
    ];
    rows.forEach((row, i) => {
      expect(row.action).toBe("UPDATED");
      expect(row.actorId).toBe(ctx.superAdmin.id);
      expect(row.actorRole).toBe("SUPER_ADMIN");
      expect(row.companyId).toBeNull();
      expect(row.outcome).toBe("SUCCESS");
      expect(row.details).toEqual({ previousPolicy: chain[i][0], newPolicy: chain[i][1] });
    });
    expect(JSON.stringify(rows)).not.toMatch(/password|otp|token|hash|secret|cookie|authorization/i);
  });
});

describe("cleanup", () => {
  it("NEVER deletes nothing", async () => {
    const oldRow = await seedAuditRow(40 * DAY_MS);
    const recentRow = await seedAuditRow(60 * 1000);
    const result = await runRetentionCleanup();
    expect(result).toMatchObject({ policy: "NEVER", cutoff: null, deleted: 0 });
    expect(await prisma.auditLog.findUnique({ where: { id: oldRow.id } })).not.toBeNull();
    expect(await prisma.auditLog.findUnique({ where: { id: recentRow.id } })).not.toBeNull();
    ctx.neverOld = oldRow;
    ctx.neverRecent = recentRow;
  });

  it("30_DAYS deletes strictly-older rows, keeps boundary and recent", async () => {
    // ±60s margins make the strict-older boundary deterministic.
    const ancient = await seedAuditRow(40 * DAY_MS);
    const older = await seedAuditRow(30 * DAY_MS + 60 * 1000);
    const boundary = await seedAuditRow(30 * DAY_MS - 60 * 1000);
    const recent = await seedAuditRow(10 * DAY_MS);
    expect((await patchPolicy(superHeaders(), { policy: "30_DAYS" })).status).toBe(200);
    const before = await prisma.auditLog.count({ where: { companyId: ctx.company.id } });
    const result = await runRetentionCleanup();
    expect(result.policy).toBe("30_DAYS");
    expect(Math.abs(result.cutoff.getTime() - (Date.now() - 30 * DAY_MS))).toBeLessThan(5 * 60 * 1000);
    // Exactly this file's three old rows are purged from its company
    // scope; the global deleted count can only be larger if unrelated
    // pre-existing rows aged out (none expected on a fresh database).
    expect(result.deleted).toBeGreaterThanOrEqual(3);
    for (const [row, gone] of [[ancient, true], [older, true], [ctx.neverOld, true], [boundary, false], [recent, false], [ctx.neverRecent, false]]) {
      // eslint-disable-next-line no-await-in-loop
      const found = await prisma.auditLog.findUnique({ where: { id: row.id } });
      if (gone) {
        expect(found).toBeNull();
      } else {
        expect(found).not.toBeNull();
      }
    }
    const after = await prisma.auditLog.count({ where: { companyId: ctx.company.id } });
    // Cleanup writes no audit rows of its own: this company's count
    // drops by exactly its three purged rows.
    expect(before - after).toBe(3);
    // Repeat runs are safe no-ops once nothing is eligible.
    expect((await runRetentionCleanup()).deleted).toBe(0);
    // Non-audit tables are untouched.
    expect(await prisma.user.findUnique({ where: { id: ctx.admin.id } })).not.toBeNull();
    expect(await prisma.company.findUnique({ where: { id: ctx.company.id } })).not.toBeNull();
  });

  it("1_YEAR honors its own cutoff", async () => {
    const ancient = await seedAuditRow(370 * DAY_MS);
    const kept = await seedAuditRow(300 * DAY_MS);
    expect((await patchPolicy(superHeaders(), { policy: "1_YEAR" })).status).toBe(200);
    // Fresh NEVER state first: nothing eligible is deleted.
    expect((await patchPolicy(superHeaders(), { policy: "NEVER" })).status).toBe(200);
    expect((await runRetentionCleanup()).deleted).toBe(0);
    expect((await patchPolicy(superHeaders(), { policy: "1_YEAR" })).status).toBe(200);
    const result = await runRetentionCleanup();
    expect(result.policy).toBe("1_YEAR");
    expect(await prisma.auditLog.findUnique({ where: { id: ancient.id } })).toBeNull();
    expect(await prisma.auditLog.findUnique({ where: { id: kept.id } })).not.toBeNull();
    expect((await patchPolicy(superHeaders(), { policy: "NEVER" })).status).toBe(200);
  });
});

describe("isolation and safety", () => {
  it("tenant smuggling cannot move platform authorization", async () => {
    const adminHeaders = headersFor(ctx.admin.id, ["ADMIN"]);
    expect((await getPolicy(adminHeaders, `?companyId=${ctx.company.id}`)).status).toBe(403);
    const smuggled = await request(app)
      .patch("/api/v1/audit-retention")
      .set({ ...adminHeaders, "x-company-id": ctx.company.id })
      .send({ policy: "NEVER", companyId: ctx.company.id });
    expect(smuggled.status).toBe(403);
  });

  it("suspended companies do not block SUPER_ADMIN retention operations", async () => {
    const suspended = await prisma.company.findUnique({ where: { id: ctx.suspendedCompany.id } });
    expect(suspended.status).toBe("SUSPENDED");
    expect((await getPolicy(superHeaders())).status).toBe(200);
    expect((await patchPolicy(superHeaders(), { policy: "30_DAYS" })).status).toBe(200);
    expect((await patchPolicy(superHeaders(), { policy: "NEVER" })).status).toBe(200);
  });

  it("no manual delete endpoint exists", async () => {
    expect((await request(app).delete("/api/v1/audit-logs").set(superHeaders())).status).toBe(404);
    expect((await request(app).delete("/api/v1/audit-retention").set(superHeaders())).status).toBe(404);
  });
});
