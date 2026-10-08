import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { COMPANY_ONE_ID } from "../helpers/userFixtures.js";

/**
 * Phase 2C-15 Super Admin company lifecycle (live HTTP + MySQL).
 *
 * Covers the platform boundary (role matrix), creation, guarded
 * suspend/restore with audit, one-ADMIN provisioning, enforcement
 * integration on a dedicated company, and aggregate-only visibility.
 * Company #1 is read-only throughout (never suspended, never mutated).
 *
 * Cleanup removes dedicated companies (no orders reference them),
 * their users/domains, and platform audit rows naming them.
 */

const RUN = `TSTCL${Date.now().toString(36).toUpperCase()}`.toLowerCase();

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
      firstName: "CoIso",
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

beforeAll(async () => {
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);
  const company = await prisma.company.create({ data: { name: `${RUN}-denied-co` } });
  createdCompanyIds.push(company.id);
  for (const [tag, role] of [["admin", "ADMIN"], ["head", "HEAD"], ["member", "MEMBER"], ["customer", "CUSTOMER"]]) {
    ctx[tag] = await createUser(`denied-${tag}`, role, company.id);
  }
  // Link the denied ADMIN as the company's provisioned ADMIN so the
  // fixture is a legitimate ADMIN: companyContext resolves and the
  // SUPER_ADMIN-only authorize gate is what rejects (AUTH_FORBIDDEN).
  // An unlinked ADMIN would fail earlier with AUTH_COMPANY_INCONSISTENT,
  // which tests the resolution boundary, not this platform boundary.
  await prisma.company.update({ where: { id: company.id }, data: { adminUserId: ctx.admin.id } });
  ctx.deniedCompany = company;
}, 120000);

afterAll(async () => {
  if (createdCompanyIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { resourceId: { in: createdCompanyIds } },
          { resourceId: { in: createdUserIds } },
          { actorId: { in: createdUserIds } },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

const superHeaders = () => headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);

describe("authorization boundary", () => {
  it.each([
    ["ADMIN", () => ctx.admin],
    ["HEAD", () => ctx.head],
    ["MEMBER", () => ctx.member],
    ["CUSTOMER", () => ctx.customer],
  ])("%s is denied company management", async (_role, idOf) => {
    const roles = { ADMIN: ["ADMIN"], HEAD: ["HEAD"], MEMBER: ["MEMBER"], CUSTOMER: ["CUSTOMER"] }[_role];
    const res = await request(app).get("/api/v1/companies").set(headersFor(idOf().id, roles));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("anonymous is denied", async () => {
    const res = await request(app).get("/api/v1/companies");
    expect(res.status).toBe(401);
  });

  it("SUPER_ADMIN lists companies with metadata only", async () => {
    const res = await request(app).get("/api/v1/companies").set(superHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.companies.length).toBeGreaterThan(0);
    for (const company of res.body.data.companies) {
      expect(Object.keys(company).sort()).toEqual(
        ["adminProvisioned", "createdAt", "domains", "googleSignInEnabled", "id", "name", "status", "updatedAt"].sort()
      );
    }
  });
});

describe("company creation", () => {
  it("creates ACTIVE companies with trimmed names and fresh UUIDs", async () => {
    const res = await request(app).post("/api/v1/companies").set(superHeaders()).send({
      name: `  ${RUN} Widget Co  `,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.company.name).toBe(`${RUN} Widget Co`);
    expect(res.body.data.company.status).toBe("ACTIVE");
    expect(res.body.data.company.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.data.company.adminProvisioned).toBe(false);
    createdCompanyIds.push(res.body.data.company.id);
    const audit = await prisma.auditLog.findFirst({
      where: { resource: "COMPANY", resourceId: res.body.data.company.id, action: "CREATED" },
    });
    expect(audit).not.toBeNull();
    expect(audit.companyId).toBeNull();
    expect(audit.actorId).toBe(ctx.superAdmin.id);
    expect(audit.actorRole).toBe("SUPER_ADMIN");
  });

  it("rejects empty names and client-supplied identity fields", async () => {
    const empty = await request(app).post("/api/v1/companies").set(superHeaders()).send({ name: "   " });
    expect(empty.status).toBe(422);
    const smuggled = await request(app).post("/api/v1/companies").set(superHeaders()).send({
      name: `${RUN} Smuggled`,
      id: "11111111-1111-1111-1111-111111111111",
      status: "SUSPENDED",
      adminUserId: ctx.superAdmin.id,
      companyId: ctx.deniedCompany.id,
    });
    // Strict schema rejects unknown identity fields outright.
    expect(smuggled.status).toBe(422);
  });

  it("duplicate names are allowed (names are not unique) and Company #1 is untouched", async () => {
    const name = `${RUN} Dupe Co`;
    for (let i = 0; i < 2; i += 1) {
      const res = await request(app).post("/api/v1/companies").set(superHeaders()).send({ name });
      expect(res.status).toBe(201);
      createdCompanyIds.push(res.body.data.company.id);
    }
    const one = await prisma.company.findUnique({ where: { id: COMPANY_ONE_ID } });
    expect(one.name).toBe("Tech Pulse");
    expect(one.status).toBe("ACTIVE");
  });
});

describe("suspend and restore", () => {
  it("ACTIVE suspends, repeat suspend is deterministic, data intact, audited", async () => {
    const created = await request(app).post("/api/v1/companies").set(superHeaders()).send({
      name: `${RUN} Lifecycle Co`,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.company.id;
    createdCompanyIds.push(id);

    const usersBefore = await prisma.user.count({ where: { companyId: id } });
    const suspended = await request(app).post(`/api/v1/companies/${id}/suspend`).set(superHeaders());
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.company.status).toBe("SUSPENDED");
    const repeat = await request(app).post(`/api/v1/companies/${id}/suspend`).set(superHeaders());
    expect(repeat.status).toBe(409);
    expect(repeat.body.error.code).toBe("COMPANY_ALREADY_SUSPENDED");

    // Nothing deleted or altered except status.
    expect(await prisma.user.count({ where: { companyId: id } })).toBe(usersBefore);
    const audit = await prisma.auditLog.findFirst({
      where: { resource: "COMPANY", resourceId: id, action: "SUSPENDED" },
    });
    expect(audit).not.toBeNull();
    expect(audit.companyId).toBeNull();
    expect(audit.actorRole).toBe("SUPER_ADMIN");
    ctx.lifecycleId = id;
  });

  it("unknown companies 404 on every lifecycle route", async () => {
    const ghost = "11111111-1111-1111-1111-111111111111";
    for (const res of [
      await request(app).get(`/api/v1/companies/${ghost}`).set(superHeaders()),
      await request(app).post(`/api/v1/companies/${ghost}/suspend`).set(superHeaders()),
      await request(app).post(`/api/v1/companies/${ghost}/restore`).set(superHeaders()),
      await request(app).post(`/api/v1/companies/${ghost}/admin`).set(superHeaders()).send({
        email: `${RUN}-ghost@example.test`,
        password: "TestPass123!",
        firstName: "Ghost",
      }),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it("restore re-activates, repeat restore is deterministic, audited", async () => {
    const restored = await request(app).post(`/api/v1/companies/${ctx.lifecycleId}/restore`).set(superHeaders());
    expect(restored.status).toBe(200);
    expect(restored.body.data.company.status).toBe("ACTIVE");
    const repeat = await request(app).post(`/api/v1/companies/${ctx.lifecycleId}/restore`).set(superHeaders());
    expect(repeat.status).toBe(409);
    expect(repeat.body.error.code).toBe("COMPANY_ALREADY_ACTIVE");
    const audit = await prisma.auditLog.findFirst({
      where: { resource: "COMPANY", resourceId: ctx.lifecycleId, action: "RESTORED" },
    });
    expect(audit).not.toBeNull();
    const detail = await request(app).get(`/api/v1/companies/${ctx.lifecycleId}`).set(superHeaders());
    expect(detail.status).toBe(200);
    expect(detail.body.data.company.aggregates).toMatchObject({
      totalUsers: expect.any(Number),
      totalProducts: expect.any(Number),
      totalOrders: expect.any(Number),
    });
    expect(JSON.stringify(detail.body.data.company)).not.toContain("orderNumber");
  });
});

describe("platform endpoint matrix", () => {
  const headersOf = {
    ADMIN: () => headersFor(ctx.admin.id, ["ADMIN"]),
    HEAD: () => headersFor(ctx.head.id, ["HEAD"]),
    MEMBER: () => headersFor(ctx.member.id, ["MEMBER"]),
    CUSTOMER: () => headersFor(ctx.customer.id, ["CUSTOMER"]),
  };

  it.each(["ADMIN", "HEAD", "MEMBER", "CUSTOMER"])("%s is rejected on every company endpoint", async (role) => {
    const headers = headersOf[role]();
    const id = ctx.deniedCompany.id;
    const attempts = [
      await request(app).post("/api/v1/companies").set(headers).send({ name: `${RUN} rogue` }),
      await request(app).get(`/api/v1/companies/${id}`).set(headers),
      await request(app).post(`/api/v1/companies/${id}/suspend`).set(headers),
      await request(app).post(`/api/v1/companies/${id}/restore`).set(headers),
      await request(app)
        .post(`/api/v1/companies/${id}/admin`)
        .set(headers)
        .send({ email: `${RUN}-rogue-${role}@example.test`, password: "TestPass123!", firstName: "Rogue" }),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    }
    expect(await prisma.user.findFirst({ where: { email: `${RUN}-rogue-${role}@example.test` } })).toBeNull();
  });

  it("anonymous is rejected on lifecycle reads and writes", async () => {
    const id = ctx.deniedCompany.id;
    for (const res of [
      await request(app).post("/api/v1/companies").send({ name: `${RUN} anon` }),
      await request(app).get(`/api/v1/companies/${id}`),
      await request(app).post(`/api/v1/companies/${id}/suspend`),
      await request(app).post(`/api/v1/companies/${id}/restore`),
    ]) {
      expect(res.status).toBe(401);
    }
  });

  it("query/header companyId tricks never reach platform management", async () => {
    const bypass = await request(app)
      .get("/api/v1/companies")
      .set(headersFor(ctx.admin.id, ["ADMIN"]))
      .query({ companyId: ctx.deniedCompany.id })
      .set("x-company-id", ctx.deniedCompany.id);
    expect(bypass.status).toBe(403);
    expect(bypass.body.error.code).toBe("AUTH_FORBIDDEN");
  });
});

describe("aggregate-only visibility", () => {
  it("Company #1 detail exposes metadata plus counts, never operational rows", async () => {
    const res = await request(app).get(`/api/v1/companies/${COMPANY_ONE_ID}`).set(superHeaders());
    expect(res.status).toBe(200);
    const company = res.body.data.company;
    expect(Object.keys(company).sort()).toEqual(
      ["adminProvisioned", "addressLine1", "addressLine2", "aggregates", "city", "contactEmail", "contactPhone", "country", "createdAt", "domains", "googleSignInEnabled", "id", "logoPath", "name", "postalCode", "state", "status", "updatedAt", "website"].sort()
    );
    expect(Object.keys(company.aggregates).sort()).toEqual(
      ["totalCustomers", "totalHeads", "totalMembers", "totalOrders", "totalProducts", "totalUsers"].sort()
    );
    for (const value of Object.values(company.aggregates)) {
      expect(typeof value).toBe("number");
    }
    // Company #1 holds real operational data (seeded users/catalog):
    // counts may be non-zero, but no row-level material may appear.
    const serialized = JSON.stringify(res.body.data);
    for (const leaked of ["passwordHash", "password_hash", "orderNumber", "refreshToken", "orderItems", "cartItems"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("restoring an ACTIVE company is a deterministic conflict", async () => {
    const created = await request(app).post("/api/v1/companies").set(superHeaders()).send({
      name: `${RUN} Fresh Restore Co`,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.company.id;
    createdCompanyIds.push(id);
    const res = await request(app).post(`/api/v1/companies/${id}/restore`).set(superHeaders());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("COMPANY_ALREADY_ACTIVE");
  });
});

describe("one-ADMIN provisioning boundary", () => {
  it("provisions exactly one linked ADMIN with its own audit event", async () => {
    const created = await request(app).post("/api/v1/companies").set(superHeaders()).send({
      name: `${RUN} Admin Co`,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.company.id;
    createdCompanyIds.push(id);
    const provisioned = await request(app).post(`/api/v1/companies/${id}/admin`).set(superHeaders()).send({
      email: `${RUN}-company-admin@example.test`,
      password: "TestPass123!",
      firstName: "Company",
    });
    expect(provisioned.status).toBe(201);
    expect(provisioned.body.data.admin.roles).toEqual(["ADMIN"]);
    const adminId = provisioned.body.data.admin.id;
    createdUserIds.push(adminId);
    const [user, company] = await Promise.all([
      prisma.user.findUnique({ where: { id: adminId } }),
      prisma.company.findUnique({ where: { id } }),
    ]);
    expect(user.companyId).toBe(id);
    expect(company.adminUserId).toBe(adminId);
    const audit = await prisma.auditLog.findFirst({
      where: { resource: "USER", resourceId: adminId, action: "CREATED" },
    });
    expect(audit).not.toBeNull();
    expect(audit.companyId).toBe(id);
    expect(audit.actorId).toBe(ctx.superAdmin.id);
    // No credential material in the audit trail.
    expect(JSON.stringify(audit)).not.toMatch(/TestPass123!/);
    ctx.provisionedCompany = id;
    ctx.provisionedAdmin = adminId;
  });

  it("second ADMIN for the same company fails without side effects", async () => {
    const before = await prisma.user.count({ where: { companyId: ctx.provisionedCompany } });
    const res = await request(app).post(`/api/v1/companies/${ctx.provisionedCompany}/admin`).set(superHeaders()).send({
      email: `${RUN}-second-admin@example.test`,
      password: "TestPass123!",
      firstName: "Second",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("COMPANY_ADMIN_EXISTS");
    expect(await prisma.user.count({ where: { companyId: ctx.provisionedCompany } })).toBe(before);
    const company = await prisma.company.findUnique({ where: { id: ctx.provisionedCompany } });
    expect(company.adminUserId).toBe(ctx.provisionedAdmin);
  });

  it("non-SUPER_ADMIN cannot provision company admins", async () => {
    const res = await request(app)
      .post(`/api/v1/companies/${ctx.provisionedCompany}/admin`)
      .set(headersFor(ctx.admin.id, ["ADMIN"]))
      .send({ email: `${RUN}-rogue@example.test`, password: "TestPass123!", firstName: "Rogue" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    expect(await prisma.user.findFirst({ where: { email: `${RUN}-rogue@example.test` } })).toBeNull();
  });
});

describe("enforcement integration on a dedicated company", () => {
  it("suspend blocks users and storefront; restore reopens both", async () => {
    const created = await request(app).post("/api/v1/companies").set(superHeaders()).send({
      name: `${RUN} Enforcement Co`,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.company.id;
    createdCompanyIds.push(id);
    const provisioned = await request(app).post(`/api/v1/companies/${id}/admin`).set(superHeaders()).send({
      email: `${RUN}-enforce-admin@example.test`,
      password: "TestPass123!",
      firstName: "Enforce",
    });
    expect(provisioned.status).toBe(201);
    createdUserIds.push(provisioned.body.data.admin.id);
    const adminHeaders = headersFor(provisioned.body.data.admin.id, ["ADMIN"]);
    const domain = `${RUN}-enforce.example.test`;
    await prisma.companyDomain.create({ data: { companyId: id, domain } });

    const suspend = await request(app).post(`/api/v1/companies/${id}/suspend`).set(superHeaders());
    expect(suspend.status).toBe(200);
    const blockedUser = await request(app).get("/api/v1/users/me").set(adminHeaders);
    expect(blockedUser.status).toBe(403);
    expect(blockedUser.body.error.code).toBe("COMPANY_SUSPENDED");
    const blockedStore = await request(app).get("/api/v1/categories").set("Host", domain);
    expect(blockedStore.status).toBe(403);
    expect(blockedStore.body.error.code).toBe("COMPANY_SUSPENDED");

    const restore = await request(app).post(`/api/v1/companies/${id}/restore`).set(superHeaders());
    expect(restore.status).toBe(200);
    const reopenedUser = await request(app).get("/api/v1/users/me").set(adminHeaders);
    expect(reopenedUser.status).toBe(200);
    const reopenedStore = await request(app).get("/api/v1/categories").set("Host", domain);
    expect(reopenedStore.status).toBe(200);
    await prisma.companyDomain.deleteMany({ where: { companyId: id } });
  });
});
