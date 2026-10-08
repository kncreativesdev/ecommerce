import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { getTestOutbox, clearTestOutbox } from "../../src/config/mailer.js";

/**
 * Phase 2C-16 reset completion + authenticated password change.
 *
 * Completion rotates credentials, watermarks refresh sessions, and
 * audits without secrets. Suspension cannot be bypassed. The change
 * flow takes identity from the session only. Company #1 is read-only.
 */

const RUN = `TSTPC${Date.now().toString(36).toUpperCase()}`.toLowerCase();

const createdUserIds = [];
const createdCompanyIds = [];
const mailFor = (email) => getTestOutbox().filter((m) => m.to === email);
const otpFrom = (mail) => /(\d{6})/.exec(mail.text)[1];
const headersFor = (id, roles) => ({ Authorization: `Bearer ${signAccessToken({ id, roles })}` });

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Change",
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

const refreshJar = (res) => res.headers["set-cookie"].find((c) => c.startsWith("refresh_token=")).split(";")[0];

/**
 * The refresh watermark has one-second granularity (documented
 * residual): a reset in the SAME second as the login cannot retire
 * that login's token. Tests asserting invalidation must cross a
 * second boundary between login and reset — otherwise they race the
 * wall clock. This waits (≤ ~1s) until the clock has moved past the
 * login's own second; later requests only move further away.
 */
async function crossSecondBoundary(loginSecond) {
  while (Math.floor(Date.now() / 1000) <= loginSecond) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const ctx = {};

beforeAll(async () => {
  clearTestOutbox();
  // Company-scoped fixtures (authenticated change needs company context).
  const company = await prisma.company.create({ data: { name: `${RUN}-co` } });
  createdCompanyIds.push(company.id);
  ctx.admin = await createUser("admin", "ADMIN", company.id);
  await prisma.company.update({ where: { id: company.id }, data: { adminUserId: ctx.admin.id } });
  ctx.member = await createUser("member", "MEMBER", company.id);
  ctx.company = company;
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

describe("reset completion", () => {
  it("rotates the password end to end", async () => {
    const user = await createUser("e2e", "CUSTOMER", ctx.company.id);
    await request(app).post("/api/v1/auth/forgot-password").send({ email: user.email });
    const code = otpFrom(mailFor(user.email).at(-1));
    await request(app).post("/api/v1/auth/verify-reset-otp").send({ email: user.email, otp: code });
    const done = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ email: user.email, otp: code, newPassword: "E2eNewPass123!" });
    expect(done.status).toBe(200);
    expect((await login(user.email, "TestPass123!")).status).toBe(401);
    expect((await login(user.email, "E2eNewPass123!")).status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row.passwordChangedAt).not.toBeNull();
  });

  it("invalidates pre-reset refresh sessions", async () => {
    const user = await createUser("watermark", "CUSTOMER", ctx.company.id);
    const loggedIn = await login(user.email, "TestPass123!");
    const oldJar = refreshJar(loggedIn);
    await crossSecondBoundary(Math.floor(Date.now() / 1000));
    await request(app).post("/api/v1/auth/forgot-password").send({ email: user.email });
    const code = otpFrom(mailFor(user.email).at(-1));
    await request(app).post("/api/v1/auth/verify-reset-otp").send({ email: user.email, otp: code });
    await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ email: user.email, otp: code, newPassword: "Watermark123!" });
    const stale = await request(app).post("/api/v1/auth/refresh").set("Cookie", oldJar);
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");
    const fresh = await request(app).post("/api/v1/auth/refresh").set("Cookie", refreshJar(await login(user.email, "Watermark123!")));
    expect(fresh.status).toBe(200);
  });

  it("cannot bypass company suspension", async () => {
    const suspended = await prisma.company.create({ data: { name: `${RUN}-suspended-co`, status: "SUSPENDED" } });
    createdCompanyIds.push(suspended.id);
    const user = await createUser("suspended", "CUSTOMER", suspended.id);
    const initiated = await request(app).post("/api/v1/auth/forgot-password").send({ email: user.email });
    expect(initiated.status).toBe(200);
    expect(mailFor(user.email)).toHaveLength(0);
    // A code obtained out of band still cannot complete while suspended.
    await prisma.passwordOtp.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        otpHash: await hashPassword("123456"),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        verifiedAt: new Date(),
      },
    });
    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ email: user.email, otp: "123456", newPassword: "Suspended123!" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
    expect((await login(user.email, "TestPass123!")).status).toBe(403);
  });

  it("one user cannot reset another user's password", async () => {
    const victim = await createUser("victim", "CUSTOMER", ctx.company.id);
    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ email: victim.email, otp: "000000", newPassword: "Attacker123!" });
    expect(res.status).toBe(400);
    expect((await login(victim.email, "TestPass123!")).status).toBe(200);
  });

  it("completion is audited without secret material", async () => {
    const audit = await prisma.auditLog.findFirst({
      where: { resource: "USER", action: "UPDATED" },
      orderBy: [{ createdAt: "desc" }],
    });
    expect(audit).not.toBeNull();
    expect(audit.outcome).toBe("SUCCESS");
    expect(JSON.stringify(audit)).not.toMatch(/E2eNewPass123!|Watermark123!|TestPass123!/);
    // Details carry only the safe operational label — no secret keys.
    expect(Object.keys(audit.details).sort()).toEqual(["via"]);
    expect(audit.details.via).toBe("password-reset");
  });
});

describe("authenticated password change", () => {
  it("rejects anonymous callers", async () => {
    const res = await request(app).post("/api/v1/auth/change-password").send({ otp: "123456", newPassword: "Nope12345!" });
    expect(res.status).toBe(401);
  });

  it("ADMIN changes password with a mailed OTP and stays signed in", async () => {
    const adminHeaders = () => headersFor(ctx.admin.id, ["ADMIN"]);
    const requested = await request(app).post("/api/v1/auth/change-password/otp").set(adminHeaders());
    expect(requested.status).toBe(200);
    const code = otpFrom(mailFor(ctx.admin.email).at(-1));
    const changed = await request(app)
      .post("/api/v1/auth/change-password")
      .set(adminHeaders())
      .send({ otp: code, newPassword: "AdminNew123!" });
    expect(changed.status).toBe(200);
    expect(typeof changed.body.data.accessToken).toBe("string");
    expect((changed.headers["set-cookie"] || []).some((c) => c.startsWith("refresh_token="))).toBe(true);
    expect((await login(ctx.admin.email, "AdminNew123!")).status).toBe(200);
  });

  it("identity comes from the session: body userId is rejected", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set(headersFor(ctx.member.id, ["MEMBER"]))
      .send({ userId: ctx.admin.id, otp: "123456", newPassword: "Hijack12345!" });
    expect(res.status).toBe(422);
    expect((await login(ctx.admin.email, "AdminNew123!")).status).toBe(200);
  });

  it("rejects wrong, expired, and reused codes", async () => {
    const memberHeaders = () => headersFor(ctx.member.id, ["MEMBER"]);
    await request(app).post("/api/v1/auth/change-password/otp").set(memberHeaders());
    const wrong = await request(app)
      .post("/api/v1/auth/change-password")
      .set(memberHeaders())
      .send({ otp: "000000", newPassword: "Wrong12345!" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("AUTH_OTP_INVALID");

    await request(app).post("/api/v1/auth/change-password/otp").set(memberHeaders());
    const user = await prisma.user.findUnique({ where: { id: ctx.member.id } });
    await prisma.passwordOtp.updateMany({
      where: { userId: user.id, purpose: "PASSWORD_CHANGE", usedAt: null },
      data: { expiresAt: new Date(Date.now() - 60 * 1000) },
    });
    const staleMail = mailFor(user.email).at(-1);
    const expired = await request(app)
      .post("/api/v1/auth/change-password")
      .set(memberHeaders())
      .send({ otp: otpFrom(staleMail), newPassword: "Expired12345!" });
    expect(expired.status).toBe(400);

    await request(app).post("/api/v1/auth/change-password/otp").set(memberHeaders());
    const code = otpFrom(mailFor(user.email).at(-1));
    const first = await request(app)
      .post("/api/v1/auth/change-password")
      .set(memberHeaders())
      .send({ otp: code, newPassword: "MemberNew123!" });
    expect(first.status).toBe(200);
    const reuse = await request(app)
      .post("/api/v1/auth/change-password")
      .set(memberHeaders())
      .send({ otp: code, newPassword: "MemberNew123!" });
    expect(reuse.status).toBe(400);
    expect((await login(user.email, "MemberNew123!")).status).toBe(200);
  });

  it("change is audited without secret material", async () => {
    const audit = await prisma.auditLog.findFirst({
      where: { resource: "USER", resourceId: ctx.member.id, action: "UPDATED" },
      orderBy: [{ createdAt: "desc" }],
    });
    expect(audit).not.toBeNull();
    expect(audit.actorId).toBe(ctx.member.id);
    expect(audit.actorRole).toBe("MEMBER");
    expect(audit.companyId).toBe(ctx.company.id);
    expect(JSON.stringify(audit)).not.toMatch(/MemberNew123!|AdminNew123!/);
    expect(Object.keys(audit.details).sort()).toEqual(["via"]);
    expect(audit.details.via).toBe("password-change");
  });
});
