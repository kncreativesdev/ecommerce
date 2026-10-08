import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin, provisionEmployee } from "../../src/modules/users/users.service.js";

/**
 * Phase 2B-2 mounted-boundary proofs (live HTTP through the real
 * middleware chain authenticate → companyContext → authorize).
 *
 * Every company user below is provisioned into a dedicated test
 * company (never Company #1); Company #1 is untouched. The dangling-
 * companyId branch is unreachable over HTTP (foreign keys prevent it)
 * and stays covered by tests/unit/company-context.test.js.
 */

const RUN = `TSTMCC${Date.now().toString(36).toUpperCase()}`;

const ctx = {
  companyA: null,
  companyB: null,
  companyS: null,
  adminA: null,
  headA: null,
  memberA: null,
  customerA: null,
  superAdmin: null,
  lonerId: null,
  impostorId: null,
};
const createdUserIds = [];
const createdCompanyIds = [];

const tokenFor = (id, roles) => signAccessToken({ id, roles });
const headersFor = (id, roles) => ({ Authorization: `Bearer ${tokenFor(id, roles)}` });

async function createUserWithRole(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN.toLowerCase()}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Mounted",
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
  for (const tag of ["a", "b"]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}` } });
    createdCompanyIds.push(company.id);
    ctx[tag === "a" ? "companyA" : "companyB"] = company;
  }
  const companyS = await prisma.company.create({ data: { name: `${RUN}-co-s`, status: "SUSPENDED" } });
  createdCompanyIds.push(companyS.id);
  ctx.companyS = companyS;

  const adminA = await provisionCompanyAdmin(ctx.companyA.id, {
    email: `${RUN.toLowerCase()}-admin-a@example.test`,
    password: "TestPass123!",
    firstName: "Mounted",
    lastName: "AdminA",
  });
  createdUserIds.push(adminA.id);
  ctx.adminA = adminA;

  const headA = await provisionEmployee(
    { id: adminA.id, companyId: ctx.companyA.id, roles: ["ADMIN"] },
    { email: `${RUN.toLowerCase()}-head-a@example.test`, password: "TestPass123!", firstName: "Mounted", lastName: "HeadA", role: "HEAD" }
  );
  createdUserIds.push(headA.id);
  ctx.headA = headA;

  const memberA = await provisionEmployee(
    { id: headA.id, companyId: ctx.companyA.id, roles: ["HEAD"] },
    { email: `${RUN.toLowerCase()}-member-a@example.test`, password: "TestPass123!", firstName: "Mounted", lastName: "MemberA", role: "MEMBER" }
  );
  createdUserIds.push(memberA.id);
  ctx.memberA = memberA;

  ctx.customerA = await createUserWithRole("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.superAdmin = await createUserWithRole("super", "SUPER_ADMIN", null);
  ctx.lonerId = (await createUserWithRole("loner", "CUSTOMER", null)).id;
  ctx.impostorId = (await createUserWithRole("impostor", "ADMIN", ctx.companyA.id)).id;

  // Phase 2C-26: public reads fail closed on unregistered hosts, so
  // the no-auth assertions below resolve the dedicated company
  // through an explicit RUN-unique test domain (removed in afterAll)
  // instead of ambient localhost state.
  ctx.publicHost = `${RUN.toLowerCase()}-public.example.test`;
  const publicDomain = await prisma.companyDomain.create({
    data: { companyId: ctx.companyA.id, domain: ctx.publicHost, isPrimary: false, isActive: true },
  });
  ctx.publicDomainId = publicDomain.id;
}, 90000);

afterAll(async () => {
  if (ctx.publicDomainId) {
    await prisma.companyDomain.deleteMany({ where: { id: ctx.publicDomainId } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

describe("mounted company context per role", () => {
  it("ADMIN receives its company context on a protected route", async () => {
    const res = await request(app).get("/api/v1/users/me").set(headersFor(ctx.adminA.id, ["ADMIN"]));
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(ctx.adminA.id);
  });

  it("HEAD receives its own company context", async () => {
    const res = await request(app).get("/api/v1/users/me").set(headersFor(ctx.headA.id, ["HEAD"]));
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(ctx.headA.id);
  });

  it("MEMBER receives its own company context", async () => {
    const res = await request(app).get("/api/v1/users/me").set(headersFor(ctx.memberA.id, ["MEMBER"]));
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(ctx.memberA.id);
  });

  it("CUSTOMER receives its company context on a protected route", async () => {
    const res = await request(app)
      .get("/api/v1/users/me")
      .set(headersFor(ctx.customerA.id, ["CUSTOMER"]));
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(ctx.customerA.id);
  });

  it("SUPER_ADMIN stays in platform context without Company #1 membership", async () => {
    const me = await request(app)
      .get("/api/v1/users/me")
      .set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(me.status).toBe(200);
    // Platform context grants no company operational access: ADMIN-only
    // routes still refuse with the pre-existing authorization code.
    const adminList = await request(app)
      .get("/api/v1/users")
      .set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(adminList.status).toBe(403);
    expect(adminList.body.error.code).toBe("AUTH_FORBIDDEN");
  });
});

describe("mounted fail-closed behavior", () => {
  it("client-supplied companyId cannot override the resolved company", async () => {
    const otherId = ctx.companyB.id;
    const payload = {
      fullName: "Override Proof",
      phone: "9999999999",
      addressLine1: "1 Company A Street",
      city: "Ludhiana",
      state: "Punjab",
      postalCode: "141002",
      country: "India",
    };
    // Query + header channels are silently ignored: the write still
    // succeeds as the caller's own company-scoped address.
    const res = await request(app)
      .post("/api/v1/addresses")
      .query({ companyId: otherId })
      .set({ ...headersFor(ctx.customerA.id, ["CUSTOMER"]), "x-company-id": otherId })
      .send(payload);
    expect(res.status).toBe(201);
    // Ownership stays with the caller regardless of the supplied ids.
    const stored = await prisma.address.findFirst({
      where: { userId: ctx.customerA.id },
      orderBy: { createdAt: "desc" },
    });
    expect(stored).not.toBeNull();
    expect(stored.fullName).toBe("Override Proof");
    // The body channel never reaches tenancy either: strict validation
    // rejects the unknown field outright (pre-existing 422 behavior).
    const rejected = await request(app)
      .post("/api/v1/addresses")
      .set(headersFor(ctx.customerA.id, ["CUSTOMER"]))
      .send({ ...payload, companyId: otherId });
    expect(rejected.status).toBe(422);
  });

  it("missing User.companyId fails closed on a mounted route", async () => {
    const res = await request(app)
      .get("/api/v1/users/me")
      .set(headersFor(ctx.lonerId, ["CUSTOMER"]));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_COMPANY_REQUIRED");
  });

  it("inconsistent ADMIN/company association fails closed before authorization", async () => {
    // The ADMIN claim would pass authorize(); the boundary must refuse
    // first with the company error, proving ordering.
    const res = await request(app).get("/api/v1/users").set(headersFor(ctx.impostorId, ["ADMIN"]));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_COMPANY_INCONSISTENT");
  });

  it("SUSPENDED company requests are rejected at the boundary (Phase 2C-13)", async () => {
    const suspendedCustomer = await createUserWithRole("suspended-c", "CUSTOMER", ctx.companyS.id);
    const res = await request(app)
      .get("/api/v1/users/me")
      .set(headersFor(suspendedCustomer.id, ["CUSTOMER"]));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
  });
});

describe("public and session routes stay outside the boundary", () => {
  it("public catalog and announcement reads need no company context", async () => {
    const categories = await request(app).get("/api/v1/categories").set("Host", ctx.publicHost);
    expect(categories.status).toBe(200);
    const products = await request(app).get("/api/v1/products").set("Host", ctx.publicHost);
    expect(products.status).toBe(200);
    const current = await request(app).get("/api/v1/announcements/current").set("Host", ctx.publicHost);
    expect(current.status).toBe(200);
  });

  it("login/register/logout behavior is unchanged", async () => {
    const email = `${RUN.toLowerCase()}-session@example.test`;
    const registered = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "TestPass123!",
      firstName: "Session",
    });
    expect(registered.status).toBe(201);
    createdUserIds.push(registered.body.data.user.id);
    const loggedIn = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "TestPass123!" });
    expect(loggedIn.status).toBe(200);
    expect(typeof loggedIn.body.data.accessToken).toBe("string");
    const loggedOut = await request(app).post("/api/v1/auth/logout");
    expect(loggedOut.status).toBe(200);
  });
});
