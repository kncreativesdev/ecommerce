import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword, verifyPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Phase 2C-16 SUPER_ADMIN company-ADMIN credential reset (live HTTP).
 *
 * The target ADMIN always derives from the route company id via
 * Company.adminUserId — no user id is ever accepted, so cross-company
 * targeting is structurally impossible. Company #1 is read-only.
 */

const RUN = `TSTCM${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const NEW_PASSWORD = "ResetPass123!";
const ORIGINAL_PASSWORD = "TestPass123!";

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
      passwordHash: await hashPassword(ORIGINAL_PASSWORD),
      firstName: "Cred",
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

async function login(email, password) {
  return request(app).post("/api/v1/auth/login").send({ email, password });
}

const refreshJar = (res) => {
  const cookie = (res.headers["set-cookie"] || []).find((c) => c.startsWith("refresh_token="));
  expect(cookie).toMatch(/^refresh_token=.+/);
  return cookie.split(";")[0];
};

/**
 * Same-second wall-clock guard as password-change.test.js: the
 * refresh watermark has one-second granularity, so invalidation
 * tests must reset strictly after the login's own second.
 */
async function crossSecondBoundary(loginSecond) {
  while (Math.floor(Date.now() / 1000) <= loginSecond) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);
  // Target company + provisioned ADMIN through the real endpoints.
  const target = await prisma.company.create({ data: { name: `${RUN}-target-co` } });
  createdCompanyIds.push(target.id);
  ctx.targetCompany = target;
  const provisioned = await request(app)
    .post(`/api/v1/companies/${target.id}/admin`)
    .set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]))
    .send({ email: `${RUN}-target-admin@example.test`, password: ORIGINAL_PASSWORD, firstName: "Target" });
  expect(provisioned.status).toBe(201);
  ctx.targetAdmin = provisioned.body.data.admin;
  createdUserIds.push(ctx.targetAdmin.id);
  ctx.oldJar = refreshJar(await login(`${RUN}-target-admin@example.test`, ORIGINAL_PASSWORD));
  ctx.loginSecond = Math.floor(Date.now() / 1000);
  // Denied fixtures: legitimate ADMIN (linked) + HEAD/MEMBER/CUSTOMER.
  const denied = await prisma.company.create({ data: { name: `${RUN}-denied-co` } });
  createdCompanyIds.push(denied.id);
  for (const [tag, role] of [["admin", "ADMIN"], ["head", "HEAD"], ["member", "MEMBER"], ["customer", "CUSTOMER"]]) {
    ctx[tag] = await createUser(`denied-${tag}`, role, denied.id);
  }
  await prisma.company.update({ where: { id: denied.id }, data: { adminUserId: ctx.admin.id } });
  ctx.deniedCompany = denied;
  // Company with no ADMIN yet.
  const bare = await prisma.company.create({ data: { name: `${RUN}-bare-co` } });
  createdCompanyIds.push(bare.id);
  ctx.bareCompany = bare;
}, 120000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ resourceId: { in: createdUserIds } }, { actorId: { in: createdUserIds } }],
    },
  });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  await prisma.$disconnect();
});

const superHeaders = () => headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
const resetUrl = (id) => `/api/v1/companies/${id}/admin/password`;

describe("authorization boundary", () => {
  it.each([["ADMIN", "admin"], ["HEAD", "head"], ["MEMBER", "member"], ["CUSTOMER", "customer"]])(
    "%s is rejected",
    async (_role, tag) => {
      const roles = { ADMIN: ["ADMIN"], HEAD: ["HEAD"], MEMBER: ["MEMBER"], CUSTOMER: ["CUSTOMER"] }[_role];
      const res = await request(app)
        .post(resetUrl(ctx.deniedCompany.id))
        .set(headersFor(ctx[tag].id, roles))
        .send({ password: NEW_PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    }
  );

  it("anonymous is rejected", async () => {
    const res = await request(app).post(resetUrl(ctx.deniedCompany.id)).send({ password: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("short passwords are rejected by policy", async () => {
    const res = await request(app).post(resetUrl(ctx.targetCompany.id)).set(superHeaders()).send({ password: "short" });
    expect(res.status).toBe(422);
  });
});

describe("target resolution", () => {
  it("nonexistent company 404s", async () => {
    const res = await request(app)
      .post(resetUrl("11111111-1111-1111-1111-111111111111"))
      .set(superHeaders())
      .send({ password: NEW_PASSWORD });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("COMPANY_NOT_FOUND");
  });

  it("company without an ADMIN fails safely", async () => {
    const res = await request(app).post(resetUrl(ctx.bareCompany.id)).set(superHeaders()).send({ password: NEW_PASSWORD });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("COMPANY_ADMIN_NOT_FOUND");
    const company = await prisma.company.findUnique({ where: { id: ctx.bareCompany.id } });
    expect(company.adminUserId).toBeNull();
  });

  it("inconsistent admin relations fail closed without writes", async () => {
    const stray = await prisma.company.create({ data: { name: `${RUN}-stray-co` } });
    createdCompanyIds.push(stray.id);
    const foreign = await createUser("foreign-member", "MEMBER", ctx.deniedCompany.id);
    await prisma.company.update({ where: { id: stray.id }, data: { adminUserId: foreign.id } });
    const before = await prisma.user.findUnique({ where: { id: foreign.id } });
    const res = await request(app).post(resetUrl(stray.id)).set(superHeaders()).send({ password: NEW_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("COMPANY_ADMIN_INCONSISTENT");
    const after = await prisma.user.findUnique({ where: { id: foreign.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await verifyPassword(after.passwordHash, ORIGINAL_PASSWORD)).toBe(true);
  });
});

describe("credential rotation", () => {
  it("rotates the designated ADMIN password without touching the link or roles", async () => {
    await crossSecondBoundary(ctx.loginSecond);
    const res = await request(app)
      .post(resetUrl(ctx.targetCompany.id))
      .set(superHeaders())
      .send({ password: NEW_PASSWORD });
    expect(res.status).toBe(200);
    const admin = res.body.data.admin;
    expect(admin.id).toBe(ctx.targetAdmin.id);
    expect(admin.roles).toEqual(["ADMIN"]);
    expect(Object.keys(admin).sort()).toEqual(
      ["createdAt", "email", "firstName", "id", "isActive", "lastName", "phone", "roles", "updatedAt"].sort()
    );
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    const [company, links, row] = await Promise.all([
      prisma.company.findUnique({ where: { id: ctx.targetCompany.id } }),
      prisma.userRole.count({ where: { userId: ctx.targetAdmin.id } }),
      prisma.user.findUnique({ where: { id: ctx.targetAdmin.id } }),
    ]);
    // Exactly-one invariant: same link, still one role, hash rotated.
    expect(company.adminUserId).toBe(ctx.targetAdmin.id);
    expect(links).toBe(1);
    expect(row.passwordHash).not.toContain(NEW_PASSWORD);
    expect(await verifyPassword(row.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(row.passwordChangedAt).not.toBeNull();
  });

  it("old password stops working, new password works", async () => {
    expect((await login(`${RUN}-target-admin@example.test`, ORIGINAL_PASSWORD)).status).toBe(401);
    const ok = await login(`${RUN}-target-admin@example.test`, NEW_PASSWORD);
    expect(ok.status).toBe(200);
    ctx.newJar = refreshJar(ok);
  });

  it("pre-rotation refresh tokens die, post-rotation refresh works", async () => {
    const stale = await request(app).post("/api/v1/auth/refresh").set("Cookie", ctx.oldJar);
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");
    const fresh = await request(app).post("/api/v1/auth/refresh").set("Cookie", ctx.newJar);
    expect(fresh.status).toBe(200);
    expect(typeof fresh.body.data.accessToken).toBe("string");
  });

  it("rotation is audited without secret material", async () => {
    const audit = await prisma.auditLog.findFirst({
      where: { resource: "USER", resourceId: ctx.targetAdmin.id, action: "UPDATED" },
      orderBy: [{ createdAt: "desc" }],
    });
    expect(audit).not.toBeNull();
    expect(audit.actorId).toBe(ctx.superAdmin.id);
    expect(audit.actorRole).toBe("SUPER_ADMIN");
    expect(audit.companyId).toBe(ctx.targetCompany.id);
    expect(audit.outcome).toBe("SUCCESS");
    expect(JSON.stringify(audit)).not.toMatch(/ResetPass123!|TestPass123!/);
    // Details carry only safe operational labels — no secret keys.
    expect(Object.keys(audit.details).sort()).toEqual(["email", "via"]);
  });
});
