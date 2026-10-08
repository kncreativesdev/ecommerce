import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Phase 2C-31 HEAD MEMBER-management HTTP surface (live HTTP + MySQL).
 *
 * Covers the new company-scoped staff endpoints on top of the existing
 * primitives (`provisionEmployee`, lifecycle, audit):
 * - POST /users (ADMIN → HEAD/MEMBER, HEAD → MEMBER only)
 * - PATCH /users/:id { isActive } (ADMIN unchanged; HEAD MEMBER-only)
 * - PATCH /users/:id/profile (ADMIN + HEAD, MEMBER targets only)
 * - GET /users + GET /users/:id (ADMIN unchanged; HEAD MEMBER-scoped)
 *
 * Tenancy always derives from the authenticated HEAD/ADMIN context —
 * body/query/header companyId can never redirect it — and every
 * unmanageable target (HEAD, ADMIN, SUPER_ADMIN, CUSTOMER, foreign
 * MEMBER, unknown id) answers the neutral 404 with no existence
 * oracle. No secrets ever leave the API.
 */

const RUN = `TSTHM${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const PASSWORD = "TestPass123!";

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function ensureRole(name) {
  let role = await prisma.role.findUnique({ where: { name } });
  if (!role) {
    role = await prisma.role.create({ data: { name } });
  }
  return role;
}

async function createStaff(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      firstName: "Hm",
      lastName: tag,
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await ensureRole(roleName);
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

const memberBody = (tag, extra = {}) => ({
  email: `${RUN}-${tag}@example.test`,
  password: PASSWORD,
  firstName: "Managed",
  lastName: tag,
  role: "MEMBER",
  ...extra,
});

beforeAll(async () => {
  ctx.superAdmin = await createStaff("super", "SUPER_ADMIN", null);
  ctx.companyA = await prisma.company.create({ data: { name: `${RUN} Head Co A` } });
  ctx.companyB = await prisma.company.create({ data: { name: `${RUN} Head Co B` } });
  createdCompanyIds.push(ctx.companyA.id, ctx.companyB.id);

  ctx.adminA = await createStaff("admin-a", "ADMIN", ctx.companyA.id);
  await prisma.company.update({ where: { id: ctx.companyA.id }, data: { adminUserId: ctx.adminA.id } });
  ctx.headA = await createStaff("head-a", "HEAD", ctx.companyA.id);
  ctx.headA2 = await createStaff("head-a2", "HEAD", ctx.companyA.id);
  ctx.memberA = await createStaff("member-a", "MEMBER", ctx.companyA.id);
  ctx.customerA = await createStaff("customer-a", "CUSTOMER", ctx.companyA.id);

  ctx.adminB = await createStaff("admin-b", "ADMIN", ctx.companyB.id);
  await prisma.company.update({ where: { id: ctx.companyB.id }, data: { adminUserId: ctx.adminB.id } });
  ctx.headB = await createStaff("head-b", "HEAD", ctx.companyB.id);
  ctx.memberB = await createStaff("member-b", "MEMBER", ctx.companyB.id);
}, 120000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { companyId: { in: createdCompanyIds } },
        { resourceId: { in: createdUserIds } },
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

const headAHeaders = () => headersFor(ctx.headA.id, ["HEAD"]);
const adminAHeaders = () => headersFor(ctx.adminA.id, ["ADMIN"]);

function expectNoSecrets(serialized) {
  for (const leaked of ["passwordHash", "password_hash", "otp", "secret", "token", "TestPass123!"]) {
    expect(serialized.toLowerCase()).not.toContain(leaked);
  }
}

describe("HEAD create MEMBER", () => {
  it("creates a MEMBER in the HEAD's own company with a safe shape", async () => {
    const res = await request(app).post("/api/v1/users").set(headAHeaders()).send(memberBody("created"));
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email: memberBody("created").email, roles: ["MEMBER"] });
    expect(res.body.data.user).not.toHaveProperty("passwordHash");
    expect(res.body.data.user).not.toHaveProperty("password");
    expectNoSecrets(JSON.stringify(res.body));
    createdUserIds.push(res.body.data.user.id);

    const stored = await prisma.user.findUnique({
      where: { id: res.body.data.user.id },
      select: { companyId: true, passwordHash: true, roles: { select: { role: { select: { name: true } } } } },
    });
    expect(stored.companyId).toBe(ctx.companyA.id);
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(stored.roles.map((link) => link.role.name)).toEqual(["MEMBER"]);

    // The stored hash authenticates: hashing used the real utility.
    const login = await request(app).post("/api/v1/auth/login").send({ email: memberBody("created").email, password: PASSWORD });
    expect(login.status).toBe(200);
    ctx.createdMemberId = res.body.data.user.id;
  });

  it("rejects role escalation outright", async () => {
    for (const role of ["ADMIN", "SUPER_ADMIN", "CUSTOMER", "HEAD"]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post("/api/v1/users").set(headAHeaders()).send(memberBody(`esc-${role.toLowerCase()}`, { role }));
      if (role === "HEAD") {
        // HEAD→HEAD is a hierarchy refusal, not a schema refusal.
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
      } else {
        expect(res.status).toBe(422);
      }
      // eslint-disable-next-line no-await-in-loop
      expect(await prisma.user.findFirst({ where: { email: memberBody(`esc-${role.toLowerCase()}`).email } })).toBeNull();
    }
  });

  it("body/query/header companyId cannot redirect provisioning", async () => {
    const smuggled = await request(app)
      .post("/api/v1/users")
      .set(headAHeaders())
      .send({ ...memberBody("smuggled"), companyId: ctx.companyB.id });
    expect(smuggled.status).toBe(422);

    const clean = await request(app)
      .post(`/api/v1/users?companyId=${ctx.companyB.id}`)
      .set({ ...headAHeaders(), "x-company-id": ctx.companyB.id })
      .send(memberBody("scoped"));
    expect(clean.status).toBe(201);
    createdUserIds.push(clean.body.data.user.id);
    const stored = await prisma.user.findUnique({ where: { id: clean.body.data.user.id }, select: { companyId: true } });
    expect(stored.companyId).toBe(ctx.companyA.id);
  });

  it("ADMIN keeps provisioning HEAD and MEMBER through the same endpoint", async () => {
    const head = await request(app).post("/api/v1/users").set(adminAHeaders()).send(memberBody("admin-head", { role: "HEAD" }));
    expect(head.status).toBe(201);
    expect(head.body.data.user.roles).toEqual(["HEAD"]);
    createdUserIds.push(head.body.data.user.id);

    const member = await request(app).post("/api/v1/users").set(adminAHeaders()).send(memberBody("admin-member", { role: "MEMBER" }));
    expect(member.status).toBe(201);
    expect(member.body.data.user.roles).toEqual(["MEMBER"]);
    createdUserIds.push(member.body.data.user.id);
  });

  it("denies MEMBER, CUSTOMER, SUPER_ADMIN, and anonymous callers", async () => {
    const memberHeaders = headersFor(ctx.memberA.id, ["MEMBER"]);
    const customerHeaders = headersFor(ctx.customerA.id, ["CUSTOMER"]);
    const superHeaders = headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
    for (const [label, headers, expected] of [
      ["member", memberHeaders, 403],
      ["customer", customerHeaders, 403],
      ["super-admin", superHeaders, 403],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post("/api/v1/users").set(headers).send(memberBody(`denied-${label}`));
      expect(res.status).toBe(expected);
      // eslint-disable-next-line no-await-in-loop
      expect(await prisma.user.findFirst({ where: { email: memberBody(`denied-${label}`).email } })).toBeNull();
    }
    const anonymous = await request(app).post("/api/v1/users").send(memberBody("denied-anon"));
    expect(anonymous.status).toBe(401);
  });
});

describe("HEAD update MEMBER profile", () => {
  it("updates an own-company MEMBER without touching identity fields", async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${ctx.createdMemberId}/profile`)
      .set(headAHeaders())
      .send({ firstName: "Renamed", phone: "1112223333" });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: ctx.createdMemberId, firstName: "Renamed", phone: "1112223333" });
    expect(res.body.data.user).not.toHaveProperty("passwordHash");
  });

  it("rejects identity/role/company/secret fields and empty bodies", async () => {
    for (const body of [
      { email: "new@example.test" },
      { password: "NewPass123!" },
      { role: "MEMBER" },
      { companyId: ctx.companyB.id },
      { isActive: false },
      {},
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).patch(`/api/v1/users/${ctx.createdMemberId}/profile`).set(headAHeaders()).send(body);
      expect(res.status).toBe(422);
    }
    const stored = await prisma.user.findUnique({ where: { id: ctx.createdMemberId }, select: { email: true, companyId: true } });
    expect(stored).toMatchObject({ email: memberBody("created").email, companyId: ctx.companyA.id });
  });
});

describe("HEAD activate/deactivate MEMBER", () => {
  it("deactivates (login blocked) and reactivates an own-company MEMBER", async () => {
    const off = await request(app).patch(`/api/v1/users/${ctx.createdMemberId}`).set(headAHeaders()).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.user).toMatchObject({ id: ctx.createdMemberId, isActive: false });

    const blocked = await request(app).post("/api/v1/auth/login").send({ email: memberBody("created").email, password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("AUTH_ACCOUNT_INACTIVE");

    const on = await request(app).patch(`/api/v1/users/${ctx.createdMemberId}`).set(headAHeaders()).send({ isActive: true });
    expect(on.status).toBe(200);
    expect(on.body.data.user.isActive).toBe(true);

    const login = await request(app).post("/api/v1/auth/login").send({ email: memberBody("created").email, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("HEAD cannot deactivate itself", async () => {
    const res = await request(app).patch(`/api/v1/users/${ctx.headA.id}`).set(headAHeaders()).send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("USER_SELF_DEACTIVATION");
    expect((await prisma.user.findUnique({ where: { id: ctx.headA.id } })).isActive).toBe(true);
  });
});

describe("HEAD target boundaries", () => {
  it.each([
    ["peer HEAD", "headA2"],
    ["company ADMIN", "adminA"],
    ["SUPER_ADMIN", "superAdmin"],
    ["CUSTOMER", "customerA"],
    ["foreign MEMBER", "memberB"],
  ])("HEAD cannot touch %s (neutral 404, target untouched)", async (_label, key) => {
    const target = ctx[key];
    const before = await prisma.user.findUnique({ where: { id: target.id } });
    for (const res of [
      await request(app).patch(`/api/v1/users/${target.id}`).set(headAHeaders()).send({ isActive: false }),
      await request(app).patch(`/api/v1/users/${target.id}/profile`).set(headAHeaders()).send({ firstName: "Nope" }),
      await request(app).get(`/api/v1/users/${target.id}`).set(headAHeaders()),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("USER_NOT_FOUND");
    }
    const after = await prisma.user.findUnique({ where: { id: target.id } });
    expect(after).toEqual(before);
  });

  it("foreign MEMBER is indistinguishable from an unknown id", async () => {
    const foreign = await request(app).patch(`/api/v1/users/${ctx.memberB.id}`).set(headAHeaders()).send({ isActive: false });
    const ghost = await request(app)
      .patch("/api/v1/users/00000000-0000-0000-0000-000000000000")
      .set(headAHeaders())
      .send({ isActive: false });
    expect(foreign.status).toBe(404);
    expect(ghost.status).toBe(404);
    expect(foreign.body).toEqual(ghost.body);
  });

  it("MEMBER and CUSTOMER cannot invoke management endpoints", async () => {
    for (const [role, id] of [["MEMBER", ctx.memberA.id], ["CUSTOMER", ctx.customerA.id]]) {
      const headers = headersFor(id, [role]);
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app).post("/api/v1/users").set(headers).send(memberBody(`nope-${role.toLowerCase()}`))).status).toBe(403);
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app).patch(`/api/v1/users/${ctx.createdMemberId}`).set(headers).send({ isActive: false })).status).toBe(403);
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app).patch(`/api/v1/users/${ctx.createdMemberId}/profile`).set(headers).send({ firstName: "X" })).status).toBe(403);
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app).get("/api/v1/users").set(headers)).status).toBe(403);
    }
  });
});

describe("HEAD member-scoped reads", () => {
  it("HEAD lists only own-company MEMBERs", async () => {
    const res = await request(app).get("/api/v1/users?limit=100").set(headAHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.users.length).toBeGreaterThan(0);
    for (const row of res.body.data.users) {
      expect(row.roles).toEqual(["MEMBER"]);
      expect(row).not.toHaveProperty("passwordHash");
    }
    const emails = res.body.data.users.map((row) => row.email);
    expect(emails).toContain(memberBody("created").email);
    expect(emails).not.toContain(ctx.adminA.email);
    expect(emails).not.toContain(ctx.headA2.email);
    expect(emails).not.toContain(ctx.customerA.email);
    expect(emails).not.toContain(ctx.memberB.email);
  });

  it("HEAD reads an own-company MEMBER but not other roles", async () => {
    const ok = await request(app).get(`/api/v1/users/${ctx.createdMemberId}`).set(headAHeaders());
    expect(ok.status).toBe(200);
    expect(ok.body.data.user).toMatchObject({ id: ctx.createdMemberId, roles: ["MEMBER"] });
  });
});

describe("HEAD management audit", () => {
  it("emits scoped USER events with safe metadata for every mutation", async () => {
    const events = await prisma.auditLog.findMany({
      where: { companyId: ctx.companyA.id, resource: "USER", resourceId: ctx.createdMemberId },
      orderBy: { createdAt: "asc" },
    });
    const byAction = (action) => events.find((event) => event.action === action);
    expect(byAction("CREATED")).toMatchObject({ actorId: ctx.headA.id, actorRole: "HEAD", outcome: "SUCCESS" });
    expect(byAction("CREATED").details).toMatchObject({ email: memberBody("created").email, role: "MEMBER" });
    expect(byAction("UPDATED").details).toMatchObject({ fields: "firstName,phone" });
    expect(byAction("DEACTIVATED")).toMatchObject({ outcome: "SUCCESS" });
    expect(byAction("REACTIVATED")).toMatchObject({ outcome: "SUCCESS" });
    for (const event of events) {
      expect(event.companyId).toBe(ctx.companyA.id);
      expectNoSecrets(JSON.stringify(event));
    }
  });

  it("failed authorization and boundary rejections emit nothing", async () => {
    const before = await prisma.auditLog.count({ where: { resource: "USER" } });
    const escalate = await request(app).post("/api/v1/users").set(headAHeaders()).send(memberBody("audit-escalate", { role: "ADMIN" }));
    expect(escalate.status).toBe(422);
    const forbidden = await request(app).patch(`/api/v1/users/${ctx.adminA.id}`).set(headAHeaders()).send({ isActive: false });
    expect(forbidden.status).toBe(404);
    expect(await prisma.auditLog.count({ where: { resource: "USER" } })).toBe(before);
  });
});
