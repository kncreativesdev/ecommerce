import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { provisionCompanyAdmin, provisionEmployee } from "../../src/modules/users/users.service.js";
import { COMPANY_ONE_ID } from "../helpers/userFixtures.js";

/**
 * Phase 2B-1 company-aware user provisioning (live MySQL, service
 * level — no new API routes are exposed in this phase).
 *
 * companyId sources under test:
 * - ADMIN: the target Company row of the internal provisioning
 *   operation (both sides linked atomically);
 * - HEAD/MEMBER: the authenticated creator's server-resolved company
 *   (a plain `{ id, companyId, roles }` context object here; route
 *   wiring will supply `req.companyContext` in a later phase);
 * - CUSTOMER/Google: deferred — current public behavior is preserved
 *   and locked below (NULL companyId until domain resolution lands).
 *
 * Dedicated test companies keep Company #1 untouched: no second ADMIN
 * is ever provisioned for it. Created users/companies are deleted in
 * cleanup; Company #1 is read-only.
 */

const RUN = `TSTUP${Date.now().toString(36).toUpperCase()}`;

const createdUserIds = [];
const createdCompanyIds = [];

async function createCompany(name) {
  const company = await prisma.company.create({ data: { name: `${RUN}-${name}` } });
  createdCompanyIds.push(company.id);
  return company;
}

function userInput(tag, extra = {}) {
  const { companyId: ignored, ...rest } = extra;
  void ignored;
  return {
    email: `${RUN.toLowerCase()}-${tag}@example.test`,
    password: "TestPass123!",
    firstName: "Provision",
    lastName: tag,
    ...rest,
  };
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

describe("ADMIN provisioning", () => {
  it("provisions exactly one ADMIN with both sides of the association linked", async () => {
    const company = await createCompany("admin-ok");
    const admin = await provisionCompanyAdmin(company.id, userInput("admin-ok"));
    createdUserIds.push(admin.id);
    expect(admin.roles).toEqual(["ADMIN"]);

    const stored = await prisma.user.findUnique({
      where: { id: admin.id },
      select: { companyId: true, roles: { select: { role: { select: { name: true } } } } },
    });
    expect(stored.companyId).toBe(company.id);
    const linked = await prisma.company.findUnique({
      where: { id: company.id },
      select: { adminUserId: true },
    });
    expect(linked.adminUserId).toBe(admin.id);
  });

  it("prevents a second ADMIN for the same company", async () => {
    const company = await createCompany("admin-dup");
    const first = await provisionCompanyAdmin(company.id, userInput("admin-dup-1"));
    createdUserIds.push(first.id);
    await expect(provisionCompanyAdmin(company.id, userInput("admin-dup-2"))).rejects.toMatchObject({
      statusCode: 409,
      code: "COMPANY_ADMIN_EXISTS",
    });
    const linked = await prisma.company.findUnique({
      where: { id: company.id },
      select: { adminUserId: true },
    });
    expect(linked.adminUserId).toBe(first.id);
  });

  it("rejects unknown companies without creating a user", async () => {
    await expect(
      provisionCompanyAdmin("11111111-1111-1111-1111-111111111111", userInput("admin-ghost"))
    ).rejects.toMatchObject({ statusCode: 404, code: "COMPANY_NOT_FOUND" });
    expect(
      await prisma.user.findFirst({ where: { email: `${RUN.toLowerCase()}-admin-ghost@example.test` } })
    ).toBeNull();
  });
});

describe("HEAD/MEMBER company inheritance", () => {
  it("HEAD inherits the creating ADMIN's company", async () => {
    const company = await createCompany("head-ok");
    const admin = await provisionCompanyAdmin(company.id, userInput("head-admin"));
    createdUserIds.push(admin.id);
    const head = await provisionEmployee(
      { id: admin.id, companyId: company.id, roles: ["ADMIN"] },
      { ...userInput("head-ok"), role: "HEAD" }
    );
    createdUserIds.push(head.id);
    expect(head.roles).toEqual(["HEAD"]);
    const stored = await prisma.user.findUnique({ where: { id: head.id }, select: { companyId: true } });
    expect(stored.companyId).toBe(company.id);
  });

  it("MEMBER inherits the creating HEAD's company", async () => {
    const company = await createCompany("member-ok");
    const admin = await provisionCompanyAdmin(company.id, userInput("member-admin"));
    createdUserIds.push(admin.id);
    const head = await provisionEmployee(
      { id: admin.id, companyId: company.id, roles: ["ADMIN"] },
      { ...userInput("member-head"), role: "HEAD" }
    );
    createdUserIds.push(head.id);
    const member = await provisionEmployee(
      { id: head.id, companyId: company.id, roles: ["HEAD"] },
      { ...userInput("member-ok"), role: "MEMBER" }
    );
    createdUserIds.push(member.id);
    const stored = await prisma.user.findUnique({ where: { id: member.id }, select: { companyId: true } });
    expect(stored.companyId).toBe(company.id);
  });

  it("a HEAD cannot create another HEAD", async () => {
    const company = await createCompany("head-nope");
    const admin = await provisionCompanyAdmin(company.id, userInput("head-nope-admin"));
    createdUserIds.push(admin.id);
    await expect(
      provisionEmployee(
        { id: admin.id, companyId: company.id, roles: ["HEAD"] },
        { ...userInput("head-nope"), role: "HEAD" }
      )
    ).rejects.toMatchObject({ statusCode: 403, code: "AUTH_FORBIDDEN" });
  });

  it("a MEMBER cannot create anyone", async () => {
    const company = await createCompany("member-nope");
    const admin = await provisionCompanyAdmin(company.id, userInput("member-nope-admin"));
    createdUserIds.push(admin.id);
    const member = await provisionEmployee(
      { id: admin.id, companyId: company.id, roles: ["ADMIN"] },
      { ...userInput("member-nope"), role: "MEMBER" }
    );
    createdUserIds.push(member.id);
    await expect(
      provisionEmployee(
        { id: member.id, companyId: company.id, roles: ["MEMBER"] },
        { ...userInput("member-nope-2"), role: "MEMBER" }
      )
    ).rejects.toMatchObject({ statusCode: 403, code: "AUTH_FORBIDDEN" });
  });
});

describe("cross-company and client-input protection", () => {
  it("a client-supplied companyId in the payload is ignored, never trusted", async () => {
    const companyA = await createCompany("cross-a");
    const companyB = await createCompany("cross-b");
    const adminA = await provisionCompanyAdmin(companyA.id, userInput("cross-admin-a"));
    createdUserIds.push(adminA.id);
    const member = await provisionEmployee(
      { id: adminA.id, companyId: companyA.id, roles: ["ADMIN"] },
      { ...userInput("cross-member"), role: "MEMBER", companyId: companyB.id }
    );
    createdUserIds.push(member.id);
    const stored = await prisma.user.findUnique({ where: { id: member.id }, select: { companyId: true } });
    expect(stored.companyId).toBe(companyA.id);
    expect(stored.companyId).not.toBe(companyB.id);
  });

  it("ADMIN, CUSTOMER, and SUPER_ADMIN roles are rejected by employee provisioning", async () => {
    const company = await createCompany("roles-nope");
    const admin = await provisionCompanyAdmin(company.id, userInput("roles-admin"));
    createdUserIds.push(admin.id);
    const creator = { id: admin.id, companyId: company.id, roles: ["ADMIN"] };
    for (const role of ["ADMIN", "CUSTOMER", "SUPER_ADMIN", "OWNER"]) {
      await expect(
        provisionEmployee(creator, { ...userInput(`roles-${role.toLowerCase()}`), role })
      ).rejects.toMatchObject({ statusCode: 422, code: "USER_PROVISION_INVALID" });
    }
  });
});

describe("deferred paths stay unchanged", () => {
  it("public CUSTOMER registration still succeeds with deferred (NULL) company assignment", async () => {
    const email = `${RUN.toLowerCase()}-deferred-customer@example.test`;
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .set("Host", `${RUN.toLowerCase()}-unregistered.example.test`)
      .send({
        email,
        password: "TestPass123!",
        firstName: "Deferred",
        lastName: "Customer",
      });
    expect(registered.status).toBe(201);
    const stored = await prisma.user.findFirst({ where: { email }, select: { id: true, companyId: true } });
    expect(stored.companyId).toBeNull();
    createdUserIds.push(stored.id);
  });

  it("Company #1 still has exactly its original ADMIN", async () => {
    const company = await prisma.company.findUnique({
      where: { id: COMPANY_ONE_ID },
      select: { adminUserId: true },
    });
    expect(company.adminUserId).not.toBeNull();
    const admin = await prisma.user.findUnique({
      where: { id: company.adminUserId },
      select: { email: true, companyId: true },
    });
    expect(admin.companyId).toBe(COMPANY_ONE_ID);
  });
});
