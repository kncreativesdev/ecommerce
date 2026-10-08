import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin, provisionEmployee } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-26 cross-company customer identity & login disambiguation
 * (live HTTP + MySQL) — part 1: identity, staff determinism,
 * registration, and data integrity.
 *
 * Part 2 (recovery, Google, suspension) lives in
 * customer-identity-recovery.test.js: the auth login/register/Google
 * routes share one 30-request rate-limit budget per app instance, and
 * both files must stay under it. Company #1 is read-only throughout.
 */

const RUN = `TSTCI${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const HOST_A = `${RUN}-shop-a.example.test`;
const HOST_B = `${RUN}-shop-b.example.test`;
const HOST_UNKNOWN = `${RUN}-unregistered.example.test`;

const SHARED_EMAIL = `${RUN}-shared@example.test`;
const SAMEPW_EMAIL = `${RUN}-samepw@example.test`;
const STAFF_SHARED_EMAIL = `${RUN}-staffshared@example.test`;
const PASSWORD_A = "CustomerAPass123!";
const PASSWORD_B = "CustomerBPass123!";
const SAME_PASSWORD = "SamePass123!";
const STAFF_PASSWORD = "StaffPass123!";
const CUSTOMER_PASSWORD = "CustPass123!";

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];
const createdDomainIds = [];

async function ensureRole(name) {
  let role = await prisma.role.findUnique({ where: { name } });
  if (!role) {
    role = await prisma.role.create({ data: { name } });
  }
  return role;
}

async function createUser(tag, roleName, companyId, email = null, password = "TestPass123!") {
  const user = await prisma.user.create({
    data: {
      email: email ?? `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword(password),
      firstName: "Identity",
      lastName: tag,
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await ensureRole(roleName);
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function addDomain(companyId, domain) {
  const row = await prisma.companyDomain.create({
    data: { companyId, domain, isPrimary: true, isActive: true },
  });
  createdDomainIds.push(row.id);
  return row;
}

async function loginOn(email, password, host = null) {
  const req = request(app).post("/api/v1/auth/login");
  if (host) req.set("Host", host);
  return req.send({ email, password });
}

beforeAll(async () => {
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"]]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
  }
  await addDomain(ctx.companyA.id, HOST_A);
  await addDomain(ctx.companyB.id, HOST_B);

  // Same email as CUSTOMER in A and B (different passwords).
  ctx.customerA = await createUser("shared-a", "CUSTOMER", ctx.companyA.id, SHARED_EMAIL, PASSWORD_A);
  ctx.customerB = await createUser("shared-b", "CUSTOMER", ctx.companyB.id, SHARED_EMAIL, PASSWORD_B);
  // Same email AND same password in A and B (domain must disambiguate).
  ctx.sameA = await createUser("samepw-a", "CUSTOMER", ctx.companyA.id, SAMEPW_EMAIL, SAME_PASSWORD);
  ctx.sameB = await createUser("samepw-b", "CUSTOMER", ctx.companyB.id, SAMEPW_EMAIL, SAME_PASSWORD);
  // Staff email shared with a customer elsewhere: ADMIN in B, CUSTOMER in A.
  ctx.adminB = await createUser("staffshared-admin", "ADMIN", ctx.companyB.id, STAFF_SHARED_EMAIL, STAFF_PASSWORD);
  ctx.customerA2 = await createUser("staffshared-cust", "CUSTOMER", ctx.companyA.id, STAFF_SHARED_EMAIL, CUSTOMER_PASSWORD);
  // Company staff + platform identity.
  ctx.adminA = await createUser("admin-a", "ADMIN", ctx.companyA.id);
  await prisma.company.update({ where: { id: ctx.companyA.id }, data: { adminUserId: ctx.adminA.id } });
  ctx.headA = await createUser("head-a", "HEAD", ctx.companyA.id);
  ctx.memberA = await createUser("member-a", "MEMBER", ctx.companyA.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);
}, 180000);

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ resourceId: { in: createdUserIds } }, { actorId: { in: createdUserIds } }],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdDomainIds.length > 0) {
    await prisma.companyDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

describe("cross-company customer identity", () => {
  it("same email coexists as CUSTOMER in A and B as distinct rows", async () => {
    const rows = await prisma.user.findMany({
      where: { email: SHARED_EMAIL },
      select: { id: true, companyId: true },
      orderBy: [{ createdAt: "asc" }],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.companyId).sort()).toEqual([ctx.companyA.id, ctx.companyB.id].sort());
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it("the compound unique rejects a second row for the same (company, email)", async () => {
    await expect(
      prisma.user.create({
        data: {
          email: SHARED_EMAIL,
          passwordHash: await hashPassword("AnotherPass123!"),
          firstName: "Dupe",
          companyId: ctx.companyA.id,
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("each domain authenticates its own customer (no cross-company sessions)", async () => {
    const onA = await loginOn(SHARED_EMAIL, PASSWORD_A, HOST_A);
    expect(onA.status).toBe(200);
    expect(onA.body.data.user.id).toBe(ctx.customerA.id);
    expect(onA.body.data.user.roles).toEqual(["CUSTOMER"]);

    const onB = await loginOn(SHARED_EMAIL, PASSWORD_B, HOST_B);
    expect(onB.status).toBe(200);
    expect(onB.body.data.user.id).toBe(ctx.customerB.id);

    // A's password on B's domain matches nobody: neutral 401, never B's session.
    const crossed = await loginOn(SHARED_EMAIL, PASSWORD_A, HOST_B);
    expect(crossed.status).toBe(401);
    expect(crossed.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");

    const crossedBack = await loginOn(SHARED_EMAIL, PASSWORD_B, HOST_A);
    expect(crossedBack.status).toBe(401);
    expect(crossedBack.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("domain disambiguates even when email and password are identical in both companies", async () => {
    const onA = await loginOn(SAMEPW_EMAIL, SAME_PASSWORD, HOST_A);
    expect(onA.status).toBe(200);
    expect(onA.body.data.user.id).toBe(ctx.sameA.id);

    const onB = await loginOn(SAMEPW_EMAIL, SAME_PASSWORD, HOST_B);
    expect(onB.status).toBe(200);
    expect(onB.body.data.user.id).toBe(ctx.sameB.id);
  });

  it("wrong passwords stay neutral 401 on registered domains (no oracle)", async () => {
    const res = await loginOn(SHARED_EMAIL, "WrongPass123!", HOST_A);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("customer login fails closed on unregistered domains", async () => {
    // Company-assigned customers require their domain; staff and legacy
    // null-company accounts are the only unscoped candidates.
    const res = await loginOn(SHARED_EMAIL, PASSWORD_A, HOST_UNKNOWN);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("client-supplied companyId cannot override domain scoping", async () => {
    const queryMix = await request(app)
      .post(`/api/v1/auth/login?companyId=${ctx.companyA.id}`)
      .set("Host", HOST_B)
      .set("x-company-id", ctx.companyA.id)
      .send({ email: SHARED_EMAIL, password: PASSWORD_A });
    expect(queryMix.status).toBe(401);

    const bodyMix = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", HOST_B)
      .send({ email: SHARED_EMAIL, password: PASSWORD_A, companyId: ctx.companyA.id });
    // The non-strict login schema strips the smuggled companyId and the
    // domain governs: A's password on B's domain matches nobody.
    expect(bodyMix.status).toBe(401);
  });

  it("email normalization stays consistent across companies", async () => {
    const mixed = `${RUN}-CaseTest@Example.Test`;
    const lower = mixed.toLowerCase();
    const created = await request(app).post("/api/v1/auth/register").set("Host", HOST_A).send({
      email: mixed,
      password: "TestPass123!",
      firstName: "Case",
    });
    expect(created.status).toBe(201);
    createdUserIds.push(created.body.data.user.id);
    const stored = await prisma.user.findFirst({ where: { email: lower } });
    expect(stored).not.toBeNull();
    expect(stored.companyId).toBe(ctx.companyA.id);

    // Uppercase login works on the owning domain.
    const loggedIn = await loginOn(mixed.toUpperCase(), "TestPass123!", HOST_A);
    expect(loggedIn.status).toBe(200);

    // The normalized twin in another company is a separate account;
    // the same normalized email in the same company is rejected.
    const twin = await request(app).post("/api/v1/auth/register").set("Host", HOST_B).send({
      email: lower,
      password: "TestPass123!",
      firstName: "Twin",
    });
    expect(twin.status).toBe(201);
    createdUserIds.push(twin.body.data.user.id);
    const dupe = await request(app).post("/api/v1/auth/register").set("Host", HOST_A).send({
      email: lower,
      password: "TestPass123!",
      firstName: "Dupe",
    });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe("AUTH_EMAIL_ALREADY_EXISTS");
  });
});

describe("staff and platform identity stays deterministic", () => {
  it("SUPER_ADMIN login is unchanged (no domain needed)", async () => {
    const res = await loginOn(`${RUN}-super@example.test`, "TestPass123!");
    expect(res.status).toBe(200);
    expect(res.body.data.user.roles).toContain("SUPER_ADMIN");
  });

  it("ADMIN, HEAD, and MEMBER logins are unchanged (no domain needed)", async () => {
    for (const tag of ["admin-a", "head-a", "member-a"]) {
      const res = await loginOn(`${RUN}-${tag}@example.test`, "TestPass123!");
      expect(res.status).toBe(200);
    }
  });

  it("staff login also works on a registered storefront domain", async () => {
    const res = await loginOn(`${RUN}-admin-a@example.test`, "TestPass123!", HOST_A);
    expect(res.status).toBe(200);
    expect(res.body.data.user.roles).toContain("ADMIN");
  });

  it("password decides between a staff row and a customer row sharing one email", async () => {
    // Customer password on the customer domain → customer session.
    const asCustomer = await loginOn(STAFF_SHARED_EMAIL, CUSTOMER_PASSWORD, HOST_A);
    expect(asCustomer.status).toBe(200);
    expect(asCustomer.body.data.user.id).toBe(ctx.customerA2.id);
    expect(asCustomer.body.data.user.roles).toEqual(["CUSTOMER"]);

    // Staff password anywhere → staff session (never the wrong identity).
    const asStaff = await loginOn(STAFF_SHARED_EMAIL, STAFF_PASSWORD, HOST_A);
    expect(asStaff.status).toBe(200);
    expect(asStaff.body.data.user.id).toBe(ctx.adminB.id);
    expect(asStaff.body.data.user.roles).toContain("ADMIN");

    const asStaffLegacy = await loginOn(STAFF_SHARED_EMAIL, STAFF_PASSWORD);
    expect(asStaffLegacy.status).toBe(200);
    expect(asStaffLegacy.body.data.user.id).toBe(ctx.adminB.id);

    // The customer password alone (no domain) cannot select the staff row.
    const customerAlone = await loginOn(STAFF_SHARED_EMAIL, CUSTOMER_PASSWORD);
    expect(customerAlone.status).toBe(401);
  });

  it("staff provisioning rejects emails held by any user anywhere", async () => {
    const company = await prisma.company.create({ data: { name: `${RUN}-staff-guard` } });
    createdCompanyIds.push(company.id);
    // The shared email is a CUSTOMER in A/B — no ADMIN may take it.
    await expect(
      provisionCompanyAdmin(company.id, {
        email: SHARED_EMAIL,
        password: "TestPass123!",
        firstName: "Guard",
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "USER_EMAIL_EXISTS" });
    // HEAD provisioning inherits the same global guard.
    await expect(
      provisionEmployee(
        { id: ctx.adminA.id, companyId: ctx.companyA.id, roles: ["ADMIN"] },
        { email: SHARED_EMAIL, password: "TestPass123!", firstName: "Guard", role: "HEAD" }
      )
    ).rejects.toMatchObject({ statusCode: 409, code: "USER_EMAIL_EXISTS" });
  });

  it("the exactly-one-ADMIN invariant still holds alongside the email guard", async () => {
    const company = await prisma.company.create({ data: { name: `${RUN}-admin-once` } });
    createdCompanyIds.push(company.id);
    const first = await provisionCompanyAdmin(company.id, {
      email: `${RUN}-once-admin@example.test`,
      password: "TestPass123!",
      firstName: "Once",
    });
    createdUserIds.push(first.id);
    await expect(
      provisionCompanyAdmin(company.id, {
        email: `${RUN}-once-admin-2@example.test`,
        password: "TestPass123!",
        firstName: "Twice",
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "COMPANY_ADMIN_EXISTS" });
  });
});

describe("scoped customer registration", () => {
  it("same email registers independently under two companies with correct stamping", async () => {
    const email = `${RUN}-http-shared@example.test`;
    const inA = await request(app).post("/api/v1/auth/register").set("Host", HOST_A).send({
      email,
      password: "TestPass123!",
      firstName: "HttpA",
    });
    expect(inA.status).toBe(201);
    createdUserIds.push(inA.body.data.user.id);
    const inB = await request(app).post("/api/v1/auth/register").set("Host", HOST_B).send({
      email,
      password: "TestPass123!",
      firstName: "HttpB",
    });
    expect(inB.status).toBe(201);
    createdUserIds.push(inB.body.data.user.id);
    expect(inB.body.data.user.id).not.toBe(inA.body.data.user.id);
    const rows = await prisma.user.findMany({ where: { email }, select: { companyId: true } });
    expect(rows.map((r) => r.companyId).sort()).toEqual([ctx.companyA.id, ctx.companyB.id].sort());
  });

  it("query/header/body companyId tricks cannot redirect registration tenancy", async () => {
    const email = `${RUN}-nosmuggle2@example.test`;
    const res = await request(app)
      .post(`/api/v1/auth/register?companyId=${ctx.companyB.id}`)
      .set("Host", HOST_A)
      .set("x-company-id", ctx.companyB.id)
      .send({ email, password: "TestPass123!", firstName: "No", companyId: ctx.companyB.id });
    expect(res.status).toBe(201);
    createdUserIds.push(res.body.data.user.id);
    const stored = await prisma.user.findFirst({ where: { email }, select: { companyId: true } });
    expect(stored.companyId).toBe(ctx.companyA.id);
  });
});
describe("migration and data integrity", () => {
  it("Company #1 and its ADMIN association are untouched", async () => {
    const company = await prisma.company.findUnique({
      where: { id: "35b5a215-0cf3-42db-ba42-6fac6656a708" },
      select: { id: true, name: true, status: true, adminUserId: true },
    });
    expect(company.name).toBe("Tech Pulse");
    expect(company.status).toBe("ACTIVE");
    expect(company.adminUserId).not.toBeNull();
    const admin = await prisma.user.findUnique({
      where: { id: company.adminUserId },
      select: { companyId: true, roles: { select: { role: { select: { name: true } } } } },
    });
    expect(admin.companyId).toBe(company.id);
    expect(admin.roles.map((l) => l.role.name)).toContain("ADMIN");
  });

  it("no duplicate (company, email) identities exist in this run's fixtures", async () => {
    const pairs = await prisma.user.groupBy({
      by: ["companyId", "email"],
      where: { email: { startsWith: RUN } },
      _count: { email: true },
    });
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(pair._count.email).toBe(1);
    }
  });

  it("no staff email is shared by two staff rows in this run's fixtures", async () => {
    const staffRows = await prisma.user.findMany({
      where: {
        email: { startsWith: RUN },
        roles: { some: { role: { name: { in: ["SUPER_ADMIN", "ADMIN", "HEAD", "MEMBER"] } } } },
      },
      select: { email: true },
    });
    const emails = staffRows.map((r) => r.email);
    expect(new Set(emails).size).toBe(emails.length);
  });
});
