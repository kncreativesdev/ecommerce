import { describe, it, expect, afterAll } from "vitest";

import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { COMPANY_ONE_ID } from "../helpers/userFixtures.js";
import {
  resolveCompanyContext,
  isPlatformContext,
} from "../../src/middleware/companyContext.js";

/**
 * Phase 2A company resolution against live MySQL (no HTTP, no route
 * wiring): real users/companies flow through the real repository and
 * middleware. Fixture users/companies are deleted in cleanup; Company
 * #1 and its ADMIN are read-only.
 */

const RUN = `TSTCC${Date.now().toString(36).toUpperCase()}`;

const createdUserIds = [];
const createdCompanyIds = [];

function run(req) {
  return new Promise((resolve) => {
    resolveCompanyContext(req, {}, (err) => resolve(err));
  });
}

function ctxReq(userId, roles = []) {
  return { user: { id: userId, roles }, query: {}, body: {}, headers: {} };
}

async function createUserWithRoleAndCompany(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN.toLowerCase()}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Ctx",
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

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

describe("live company resolution per role", () => {
  it("ADMIN resolves to the company referenced by User.companyId", async () => {
    const company = await prisma.company.findUnique({
      where: { id: COMPANY_ONE_ID },
      select: { adminUserId: true },
    });
    expect(company.adminUserId).not.toBeNull();
    const req = ctxReq(company.adminUserId, ["ADMIN"]);
    const err = await run(req);
    expect(err).toBeUndefined();
    expect(req.companyContext.companyId).toBe(COMPANY_ONE_ID);
    expect(req.companyContext.company.status).toBe("ACTIVE");
    expect(isPlatformContext(req)).toBe(false);
  });

  it("uses database roles, not token claims, for resolution", async () => {
    const company = await prisma.company.findUnique({
      where: { id: COMPANY_ONE_ID },
      select: { adminUserId: true },
    });
    // Empty/stale claims must not matter: the database decides.
    const req = ctxReq(company.adminUserId, []);
    const err = await run(req);
    expect(err).toBeUndefined();
    expect(req.companyContext.companyId).toBe(COMPANY_ONE_ID);
  });

  it("HEAD resolves to its User.companyId company", async () => {
    const user = await createUserWithRoleAndCompany("head", "HEAD", COMPANY_ONE_ID);
    const req = ctxReq(user.id, ["HEAD"]);
    const err = await run(req);
    expect(err).toBeUndefined();
    expect(req.companyContext.companyId).toBe(COMPANY_ONE_ID);
  });

  it("MEMBER resolves to its User.companyId company", async () => {
    const user = await createUserWithRoleAndCompany("member", "MEMBER", COMPANY_ONE_ID);
    const req = ctxReq(user.id, ["MEMBER"]);
    const err = await run(req);
    expect(err).toBeUndefined();
    expect(req.companyContext.companyId).toBe(COMPANY_ONE_ID);
  });

  it("CUSTOMER resolves to its User.companyId company", async () => {
    const user = await createUserWithRoleAndCompany("customer", "CUSTOMER", COMPANY_ONE_ID);
    const req = ctxReq(user.id, ["CUSTOMER"]);
    const err = await run(req);
    expect(err).toBeUndefined();
    expect(req.companyContext.companyId).toBe(COMPANY_ONE_ID);
  });

  it("SUPER_ADMIN operates in platform context with null companyId", async () => {
    const user = await createUserWithRoleAndCompany("super", "SUPER_ADMIN", null);
    const req = ctxReq(user.id, ["SUPER_ADMIN"]);
    const err = await run(req);
    expect(err).toBeUndefined();
    expect(req.companyContext).toEqual({
      companyId: null,
      company: null,
      isPlatformContext: true,
      source: "platform",
    });
    expect(isPlatformContext(req)).toBe(true);
  });
});

describe("live fail-closed branches", () => {
  it("non-SUPER_ADMIN with null companyId fails closed", async () => {
    const user = await createUserWithRoleAndCompany("nocompany", "CUSTOMER", null);
    const err = await run(ctxReq(user.id, ["CUSTOMER"]));
    expect(err).toMatchObject({ statusCode: 403, code: "AUTH_COMPANY_REQUIRED" });
  });

  it("ADMIN inconsistent with Company.adminUserId fails closed", async () => {
    const user = await createUserWithRoleAndCompany("impostor", "ADMIN", COMPANY_ONE_ID);
    const err = await run(ctxReq(user.id, ["ADMIN"]));
    expect(err).toMatchObject({ statusCode: 403, code: "AUTH_COMPANY_INCONSISTENT" });
  });

  it("client-supplied companyId cannot override the resolved company", async () => {
    const user = await createUserWithRoleAndCompany("override", "CUSTOMER", COMPANY_ONE_ID);
    const req = {
      user: { id: user.id, roles: ["CUSTOMER"] },
      query: { companyId: "11111111-1111-1111-1111-111111111111" },
      body: { companyId: "11111111-1111-1111-1111-111111111111" },
      headers: { "x-company-id": "11111111-1111-1111-1111-111111111111" },
    };
    const err = await run(req);
    expect(err).toBeUndefined();
    expect(req.companyContext.companyId).toBe(COMPANY_ONE_ID);
  });

  it("SUSPENDED status is exposed without enforcement", async () => {
    const company = await prisma.company.create({
      data: { name: `${RUN}-suspended`, status: "SUSPENDED" },
    });
    createdCompanyIds.push(company.id);
    const user = await createUserWithRoleAndCompany("suspended", "CUSTOMER", company.id);
    const req = ctxReq(user.id, ["CUSTOMER"]);
    const err = await run(req);
    expect(err).toBeUndefined();
    expect(req.companyContext.companyId).toBe(company.id);
    expect(req.companyContext.company.status).toBe("SUSPENDED");
  });
});
