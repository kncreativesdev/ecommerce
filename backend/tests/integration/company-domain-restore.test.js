import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import {
  resolvePublicCompanyContext,
  getCompanyContext,
} from "../../src/middleware/companyContext.js";

/**
 * Phase 2C-28 restore/domain-state hardening (live HTTP + MySQL).
 *
 * Proves company status and domain `isActive` are separate state
 * dimensions: suspending, mutating domain state while suspended, and
 * restoring changes ONLY the company row. An independently
 * deactivated domain stays inactive (and unresolving) after restore,
 * the still-active domain resolves again, no domain row is created
 * or duplicated, and company-scoped audit history survives intact.
 */

const RUN = `TSTRS${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const domain = (tag) => `${RUN}-${tag}.example.test`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];
const createdDomainIds = [];

const superHeaders = () => ({
  Authorization: `Bearer ${signAccessToken({ id: ctx.superAdmin.id, roles: ["SUPER_ADMIN"] })}`,
});

function runPublicMiddleware(host) {
  const req = {
    get: (name) => (String(name).toLowerCase() === "host" ? host : undefined),
    headers: {},
  };
  return new Promise((resolve) => {
    resolvePublicCompanyContext(req, {}, (err) => resolve({ err, req }));
  });
}

beforeAll(async () => {
  const superAdmin = await prisma.user.create({
    data: {
      email: `${RUN}-super@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Restore",
      lastName: "Probe",
      companyId: null,
    },
  });
  createdUserIds.push(superAdmin.id);
  let role = await prisma.role.findUnique({ where: { name: "SUPER_ADMIN" } });
  if (!role) {
    role = await prisma.role.create({ data: { name: "SUPER_ADMIN" } });
  }
  await prisma.userRole.create({ data: { userId: superAdmin.id, roleId: role.id } });
  ctx.superAdmin = superAdmin;

  const created = await request(app)
    .post("/api/v1/companies")
    .set(superHeaders())
    .send({ name: `${RUN} Restore Co` });
  expect(created.status).toBe(201);
  ctx.company = created.body.data.company;
  createdCompanyIds.push(ctx.company.id);
}, 120000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { resourceId: { in: createdCompanyIds } },
        { resourceId: { in: createdUserIds } },
        { resourceId: { in: createdDomainIds } },
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

describe("restore preserves independent domain state", () => {
  it("restore reactivates routing but never reactivates a deactivated domain", async () => {
    const first = await request(app)
      .post(`/api/v1/companies/${ctx.company.id}/domains`)
      .set(superHeaders())
      .send({ domain: domain("keep") });
    expect(first.status).toBe(201);
    expect(first.body.data.domain).toMatchObject({ domain: domain("keep"), isPrimary: true, isActive: true });
    const second = await request(app)
      .post(`/api/v1/companies/${ctx.company.id}/domains`)
      .set(superHeaders())
      .send({ domain: domain("parked") });
    expect(second.status).toBe(201);
    expect(second.body.data.domain).toMatchObject({ domain: domain("parked"), isPrimary: false, isActive: true });
    createdDomainIds.push(first.body.data.domain.id, second.body.data.domain.id);
    const auditBefore = await prisma.auditLog.count({
      where: { resource: "COMPANY_DOMAIN", companyId: ctx.company.id },
    });
    expect(auditBefore).toBe(2);

    const suspended = await request(app).post(`/api/v1/companies/${ctx.company.id}/suspend`).set(superHeaders());
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.company.status).toBe("SUSPENDED");

    // Suspension blocks the storefront even though both domains are active.
    const blocked = await request(app).get("/api/v1/categories").set("Host", domain("keep"));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("COMPANY_SUSPENDED");

    // Independently deactivate one domain while suspended (platform
    // management stays allowed on suspended companies).
    const parked = await request(app)
      .patch(`/api/v1/companies/${ctx.company.id}/domains/${second.body.data.domain.id}`)
      .set(superHeaders())
      .send({ isActive: false });
    expect(parked.status).toBe(200);
    expect(parked.body.data.domain).toMatchObject({ isActive: false, isPrimary: false });

    const restored = await request(app).post(`/api/v1/companies/${ctx.company.id}/restore`).set(superHeaders());
    expect(restored.status).toBe(200);
    expect(restored.body.data.company.status).toBe("ACTIVE");

    // Exactly the two registry rows exist — restore recreated nothing.
    const rows = await prisma.companyDomain.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((row) => row.domain).sort()).toEqual([domain("keep"), domain("parked")].sort());
    const keep = rows.find((row) => row.domain === domain("keep"));
    const parkedRow = rows.find((row) => row.domain === domain("parked"));
    expect(keep).toMatchObject({ isActive: true, isPrimary: true });
    expect(parkedRow).toMatchObject({ isActive: false, isPrimary: false });

    // Routing follows domain state, not company status: the active
    // domain resolves again, the parked one stays unresolving.
    const { err: errKeep, req: reqKeep } = await runPublicMiddleware(domain("keep"));
    expect(errKeep).toBeUndefined();
    expect(reqKeep.companyContext).toMatchObject({ companyId: ctx.company.id, source: "domain" });
    const { err: errParked, req: reqParked } = await runPublicMiddleware(domain("parked"));
    expect(errParked).toBeUndefined();
    expect(getCompanyContext(reqParked)).toBeNull();

    // Live storefront confirms the restored company serves traffic again.
    const reopened = await request(app).get("/api/v1/categories").set("Host", domain("keep"));
    expect(reopened.status).toBe(200);

    // Audit history survived the suspend/restore cycle untouched: the
    // two CREATED events plus the deactivation UPDATED event.
    const events = await prisma.auditLog.findMany({
      where: { resource: "COMPANY_DOMAIN", companyId: ctx.company.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(auditBefore + 1);
    expect(events.map((event) => event.action)).toEqual(["CREATED", "CREATED", "UPDATED"]);
    for (const event of events) {
      expect(event.actorRole).toBe("SUPER_ADMIN");
      expect(event.outcome).toBe("SUCCESS");
    }
  });
});
