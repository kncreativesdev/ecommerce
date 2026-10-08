import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";

import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { getTestOutbox, clearTestOutbox } from "../../src/config/mailer.js";
import { createRequire } from "module";

const nativeRequire = createRequire(import.meta.url);
const nativeEnv = nativeRequire("../../src/config/env.js").env;

/**
 * Phase 2C-26 cross-company customer identity & login disambiguation
 * (live HTTP + MySQL) — part 2: scoped password recovery, scoped
 * Google sign-in, and suspension/session binding.
 *
 * Part 1 (identity, staff determinism, registration, integrity) lives
 * in customer-identity.test.js: the auth login/register/Google routes
 * share one 30-request rate-limit budget per app instance, and both
 * files must stay under it (this file uses ~15). Company #1 is
 * read-only throughout.
 */

const RUN = `TSTCJ${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const HOST_A = `${RUN}-shop-a.example.test`;
const HOST_B = `${RUN}-shop-b.example.test`;
const HOST_S = `${RUN}-shop-s.example.test`;
const HOST_UNKNOWN = `${RUN}-unregistered.example.test`;

const SHARED_EMAIL = `${RUN}-shared@example.test`;
const SAMEPW_EMAIL = `${RUN}-samepw@example.test`;
const PASSWORD_A = "CustomerAPass123!";
const PASSWORD_B = "CustomerBPass123!";
const SAME_PASSWORD = "SamePass123!";
const NEW_PASSWORD_A = "CustomerANew123!";

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];
const createdDomainIds = [];

const mailFor = (email) => getTestOutbox().filter((m) => m.to === email);
const otpFrom = (mail) => {
  const match = /(\d{6})/.exec(mail.text);
  expect(match).not.toBeNull();
  return match[1];
};

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

// --- Google stub (same pattern as auth-google.test.js: generated RSA
// keypair, no network, no real credentials) ---
const GOOGLE_CLIENT_ID = "test-identity-client.apps.googleusercontent.com";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_JWK = { ...publicKey.export({ format: "jwk" }), kid: "identity-kid", alg: "RS256", use: "sig" };

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signIdToken(payload) {
  const input = `${base64url({ alg: "RS256", kid: "identity-kid", typ: "JWT" })}.${base64url(payload)}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(input, "utf8"), privateKey).toString("base64url");
  return `${input}.${signature}`;
}

function googlePayload(email) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "accounts.google.com",
    aud: GOOGLE_CLIENT_ID,
    exp: now + 3600,
    iat: now,
    email,
    email_verified: true,
    given_name: "Google",
    family_name: "Identity",
  };
}

async function googleOn(email, host = null) {
  const req = request(app).post("/api/v1/auth/google");
  if (host) req.set("Host", host);
  return req.send({ idToken: signIdToken(googlePayload(email)) });
}

function stubGoogleCerts() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ keys: [PUBLIC_JWK] }) })
  );
}

const realClientId = nativeEnv.googleClientId;

beforeAll(async () => {
  clearTestOutbox();
  nativeEnv.googleClientId = GOOGLE_CLIENT_ID;
  stubGoogleCerts();
  const { clearGoogleCertsCache } = await import("../../src/modules/auth/auth.google.js");
  clearGoogleCertsCache();

  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
  }
  await addDomain(ctx.companyA.id, HOST_A);
  await addDomain(ctx.companyB.id, HOST_B);
  await addDomain(ctx.companyS.id, HOST_S);

  ctx.customerA = await createUser("shared-a", "CUSTOMER", ctx.companyA.id, SHARED_EMAIL, PASSWORD_A);
  ctx.customerB = await createUser("shared-b", "CUSTOMER", ctx.companyB.id, SHARED_EMAIL, PASSWORD_B);
  ctx.sameA = await createUser("samepw-a", "CUSTOMER", ctx.companyA.id, SAMEPW_EMAIL, SAME_PASSWORD);
  ctx.sameB = await createUser("samepw-b", "CUSTOMER", ctx.companyB.id, SAMEPW_EMAIL, SAME_PASSWORD);
  ctx.customerS = await createUser("customer-s", "CUSTOMER", ctx.companyS.id);
}, 180000);

beforeEach(() => {
  nativeEnv.googleClientId = GOOGLE_CLIENT_ID;
  stubGoogleCerts();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  nativeEnv.googleClientId = realClientId;
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

describe("scoped password recovery", () => {
  it("a Company A reset affects only Company A (passwords + watermark stay per-account)", async () => {
    expect(mailFor(SHARED_EMAIL)).toHaveLength(0);
    const forgotA = await request(app).post("/api/v1/auth/forgot-password").set("Host", HOST_A).send({
      email: SHARED_EMAIL,
    });
    expect(forgotA.status).toBe(200);
    expect(mailFor(SHARED_EMAIL)).toHaveLength(1);
    const codeA = otpFrom(mailFor(SHARED_EMAIL).at(-1));

    const verified = await request(app)
      .post("/api/v1/auth/verify-reset-otp")
      .set("Host", HOST_A)
      .send({ email: SHARED_EMAIL, otp: codeA });
    expect(verified.status).toBe(200);

    // B's login cookie predates A's rotation and must survive it.
    const beforeB = await loginOn(SHARED_EMAIL, PASSWORD_B, HOST_B);
    expect(beforeB.status).toBe(200);
    const cookieB = beforeB.headers["set-cookie"];

    const done = await request(app).post("/api/v1/auth/reset-password").set("Host", HOST_A).send({
      email: SHARED_EMAIL,
      otp: codeA,
      newPassword: NEW_PASSWORD_A,
    });
    expect(done.status).toBe(200);

    // A authenticates with the new password; B is untouched.
    expect((await loginOn(SHARED_EMAIL, NEW_PASSWORD_A, HOST_A)).status).toBe(200);
    expect((await loginOn(SHARED_EMAIL, PASSWORD_A, HOST_A)).status).toBe(401);
    expect((await loginOn(SHARED_EMAIL, PASSWORD_B, HOST_B)).status).toBe(200);

    // B's pre-rotation refresh session still renews (watermark is per-account).
    const refreshedB = await request(app).post("/api/v1/auth/refresh").set("Cookie", cookieB.join("; "));
    expect(refreshedB.status).toBe(200);
    expect(typeof refreshedB.body.data.accessToken).toBe("string");
  });

  it("Company A's code is useless on Company B (OTP binds to the scoped userId)", async () => {
    const forgotA = await request(app).post("/api/v1/auth/forgot-password").set("Host", HOST_A).send({
      email: SAMEPW_EMAIL,
    });
    expect(forgotA.status).toBe(200);
    const codeA = otpFrom(mailFor(SAMEPW_EMAIL).at(-1));

    const onB = await request(app).post("/api/v1/auth/verify-reset-otp").set("Host", HOST_B).send({
      email: SAMEPW_EMAIL,
      otp: codeA,
    });
    // B has its own account (no live OTP): A's code is simply invalid there.
    expect(onB.status).toBe(400);
    expect(onB.body.error.code).toBe("AUTH_OTP_INVALID");
  });

  it("uniform responses hold: unknown emails and ambiguous unscoped emails reveal nothing", async () => {
    const message = "If an account exists for this email, a verification code has been sent.";
    const unknown = await request(app).post("/api/v1/auth/forgot-password").set("Host", HOST_A).send({
      email: `${RUN}-nobody@example.test`,
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data).toEqual({ message });

    // SHARED_EMAIL exists in A and B: an unscoped request is ambiguous,
    // so no code is issued — observably identical to a missing account.
    const before = mailFor(SHARED_EMAIL).length;
    const ambiguous = await request(app).post("/api/v1/auth/forgot-password").set("Host", HOST_UNKNOWN).send({
      email: SHARED_EMAIL,
    });
    expect(ambiguous.status).toBe(200);
    expect(ambiguous.body.data).toEqual({ message });
    expect(mailFor(SHARED_EMAIL)).toHaveLength(before);

    const ambiguousVerify = await request(app)
      .post("/api/v1/auth/verify-reset-otp")
      .set("Host", HOST_UNKNOWN)
      .send({ email: SHARED_EMAIL, otp: "000000" });
    expect(ambiguousVerify.status).toBe(400);
    expect(ambiguousVerify.body.error.code).toBe("AUTH_OTP_INVALID");
  });

  it("audit rows for same-email resets carry distinct per-account actor ids", async () => {
    const rows = await prisma.auditLog.findMany({
      where: { resource: "USER", action: "UPDATED", resourceId: { in: [ctx.customerA.id, ctx.customerB.id] } },
      select: { actorId: true, actorEmail: true, companyId: true, resourceId: true },
      orderBy: [{ createdAt: "desc" }],
    });
    const forA = rows.filter((r) => r.resourceId === ctx.customerA.id);
    expect(forA.length).toBeGreaterThan(0);
    // The actor is the scoped account itself — never the same-email twin.
    expect(forA[0].actorId).toBe(ctx.customerA.id);
    expect(forA[0].companyId).toBe(ctx.companyA.id);
  });
});

describe("scoped Google sign-in", () => {
  it("creates one CUSTOMER per domain company for the same verified email", async () => {
    const email = `${RUN}-g-shared@example.test`;
    const inA = await googleOn(email, HOST_A);
    expect(inA.status).toBe(200);
    createdUserIds.push(inA.body.data.user.id);
    const inB = await googleOn(email, HOST_B);
    expect(inB.status).toBe(200);
    createdUserIds.push(inB.body.data.user.id);
    expect(inB.body.data.user.id).not.toBe(inA.body.data.user.id);
    const rows = await prisma.user.findMany({ where: { email }, select: { companyId: true } });
    expect(rows.map((r) => r.companyId).sort()).toEqual([ctx.companyA.id, ctx.companyB.id].sort());
  });

  it("links repeat domain sign-ins to the same company account", async () => {
    const email = `${RUN}-g-repeat@example.test`;
    const first = await googleOn(email, HOST_A);
    expect(first.status).toBe(200);
    createdUserIds.push(first.body.data.user.id);
    const second = await googleOn(email, HOST_A);
    expect(second.status).toBe(200);
    expect(second.body.data.user.id).toBe(first.body.data.user.id);
  });

  it("an ambiguous unscoped Google email fails closed with a neutral storefront directive", async () => {
    // SHARED_EMAIL has non-staff accounts in A and B and no staff row:
    // without a domain the identity cannot be chosen.
    const res = await googleOn(SHARED_EMAIL);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("AUTH_GOOGLE_AMBIGUOUS_IDENTITY");
  });
});

describe("suspension and session binding", () => {
  it("suspended-company customer login is rejected on its domain and on legacy hosts", async () => {
    const blocked = await loginOn(`${RUN}-customer-s@example.test`, "TestPass123!", HOST_S);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("COMPANY_SUSPENDED");

    // Sole-account legacy semantics are preserved unscoped (exactly one
    // row holds the email, so no disambiguation is needed).
    const legacy = await loginOn(`${RUN}-customer-s@example.test`, "TestPass123!", HOST_UNKNOWN);
    expect(legacy.status).toBe(403);
    expect(legacy.body.error.code).toBe("COMPANY_SUSPENDED");
  });

  it("the Host header can never move an authenticated identity across companies", async () => {
    const onB = await loginOn(SHARED_EMAIL, PASSWORD_B, HOST_B);
    expect(onB.status).toBe(200);
    const me = await request(app)
      .get("/api/v1/users/me")
      .set("Host", HOST_A)
      .set({ Authorization: `Bearer ${onB.body.data.accessToken}` });
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(ctx.customerB.id);
  });
});
