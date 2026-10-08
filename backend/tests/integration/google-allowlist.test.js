import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { clearGoogleCertsCache } from "../../src/modules/auth/auth.google.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { createRequire } from "module";

// Same native-require env injection as auth-google.test.js: backend
// sources load through native require(), so the Google client ID is
// set on that instance (import-graph mutation would be invisible).
const nativeRequire = createRequire(import.meta.url);
const nativeEnv = nativeRequire("../../src/config/env.js").env;

/**
 * Phase 4-4 company-scoped Google sign-in allowlist (live HTTP +
 * MySQL, Google JWKS stubbed with a generated RSA keypair).
 *
 * Model: `Company.googleSignInEnabled` (default true — rollout
 * changes nothing). SUPER_ADMIN-only
 * `PATCH /companies/:id/google-signin { enabled }`; the scoped
 * Google flow fails closed (403 AUTH_GOOGLE_NOT_ALLOWED) before
 * token verification, linking, or creation when disabled.
 * Unscoped legacy behavior is untouched.
 */

const RUN = `TSTGA${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const CLIENT_ID = "test-google-client.apps.googleusercontent.com";
const PASSWORD = "TestPass123!";

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_JWK = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" };

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signIdToken(payload) {
  const input = `${base64url({ alg: "RS256", kid: "test-kid", typ: "JWT" })}.${base64url(payload)}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(input, "utf8"), privateKey).toString("base64url");
  return `${input}.${signature}`;
}

function googleToken(email) {
  const now = Math.floor(Date.now() / 1000);
  return signIdToken({
    iss: "accounts.google.com",
    aud: CLIENT_ID,
    exp: now + 3600,
    iat: now,
    email,
    email_verified: true,
    given_name: "Google",
    family_name: "Tester",
  });
}

const superHeaders = () => headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);

function headersFor(id, roles) {
  return { Authorization: `Bearer ${signAccessToken({ id, roles })}` };
}

async function createStaff(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      firstName: "Allow",
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

function stubGoogleCerts() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [PUBLIC_JWK] }),
    })
  );
}

const realClientId = nativeEnv.googleClientId;

beforeAll(async () => {
  nativeEnv.googleClientId = CLIENT_ID;
  stubGoogleCerts();

  ctx.superAdmin = await createStaff("super", "SUPER_ADMIN", null);
  for (const tag of ["a", "b"]) {
    // eslint-disable-next-line no-await-in-loop
    const created = await request(app).post("/api/v1/companies").set(superHeaders()).send({ name: `${RUN} Allow Co ${tag}` });
    expect(created.status).toBe(201);
    createdCompanyIds.push(created.body.data.company.id);
    ctx[`company${tag.toUpperCase()}`] = created.body.data.company;
    // eslint-disable-next-line no-await-in-loop
    const dom = await request(app)
      .post(`/api/v1/companies/${created.body.data.company.id}/domains`)
      .set(superHeaders())
      .send({ domain: `${RUN}-${tag}.example.test` });
    expect(dom.status).toBe(201);
  }
  ctx.adminA = await createStaff("admin-a", "ADMIN", ctx.companyA.id);
  await prisma.company.update({ where: { id: ctx.companyA.id }, data: { adminUserId: ctx.adminA.id } });
  ctx.headA = await createStaff("head-a", "HEAD", ctx.companyA.id);
  ctx.memberA = await createStaff("member-a", "MEMBER", ctx.companyA.id);
  ctx.customerA = await createStaff("customer-a", "CUSTOMER", ctx.companyA.id);
}, 180000);

beforeEach(() => {
  nativeEnv.googleClientId = CLIENT_ID;
  clearGoogleCertsCache();
  stubGoogleCerts();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  nativeEnv.googleClientId = realClientId;
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

const hostA = () => `${RUN}-a.example.test`;
const hostB = () => `${RUN}-b.example.test`;

async function setGoogleSignIn(companyId, enabled) {
  return request(app).patch(`/api/v1/companies/${companyId}/google-signin`).set(superHeaders()).send({ enabled });
}

describe("allowlist management authorization", () => {
  it("SUPER_ADMIN toggles the flag with the exact contract", async () => {
    const off = await setGoogleSignIn(ctx.companyA.id, false);
    expect(off.status).toBe(200);
    expect(off.body.data.company).toMatchObject({ id: ctx.companyA.id, googleSignInEnabled: false });

    const on = await setGoogleSignIn(ctx.companyA.id, true);
    expect(on.status).toBe(200);
    expect(on.body.data.company.googleSignInEnabled).toBe(true);
  });

  it("unknown companies 404; malformed bodies 422; smuggled companyId rejected", async () => {
    const ghost = await setGoogleSignIn("11111111-1111-1111-1111-111111111111", false);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe("COMPANY_NOT_FOUND");

    for (const body of [{}, { enabled: "yes" }, { enabled: 1 }, { enabled: false, companyId: ctx.companyB.id }]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).patch(`/api/v1/companies/${ctx.companyA.id}/google-signin`).set(superHeaders()).send(body);
      expect(res.status).toBe(422);
    }
  });

  it("ADMIN/HEAD/MEMBER/CUSTOMER cannot configure; anonymous denied", async () => {
    for (const [role, id] of [["ADMIN", ctx.adminA.id], ["HEAD", ctx.headA.id], ["MEMBER", ctx.memberA.id], ["CUSTOMER", ctx.customerA.id]]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).patch(`/api/v1/companies/${ctx.companyA.id}/google-signin`).set(headersFor(id, [role])).send({ enabled: false });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    }
    expect((await request(app).patch(`/api/v1/companies/${ctx.companyA.id}/google-signin`).send({ enabled: false })).status).toBe(401);
    // No staff write leaked through: flag untouched.
    const row = await prisma.company.findUnique({ where: { id: ctx.companyA.id }, select: { googleSignInEnabled: true } });
    expect(row.googleSignInEnabled).toBe(true);
  });

  it("records one scoped COMPANY/UPDATED audit per change and nothing on failure", async () => {
    const before = await prisma.auditLog.count({ where: { resource: "COMPANY", companyId: ctx.companyA.id } });
    await setGoogleSignIn(ctx.companyA.id, false);
    const events = await prisma.auditLog.findMany({
      where: { resource: "COMPANY", companyId: ctx.companyA.id, action: "UPDATED" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: ctx.superAdmin.id,
      actorRole: "SUPER_ADMIN",
      companyId: ctx.companyA.id,
      resourceId: ctx.companyA.id,
      outcome: "SUCCESS",
    });
    expect(events[0].details).toMatchObject({ googleSignInEnabled: false, previousValue: true });
    expectNoSecrets(JSON.stringify(events[0]));
    await setGoogleSignIn(ctx.companyA.id, true);

    const bad = await request(app).patch(`/api/v1/companies/${ctx.companyA.id}/google-signin`).set(superHeaders()).send({});
    expect(bad.status).toBe(422);
    expect(await prisma.auditLog.count({ where: { resource: "COMPANY", companyId: ctx.companyA.id } })).toBe(before + 2);
  });
});

function expectNoSecrets(serialized) {
  for (const leaked of ["password", "secret", "token", "authorization", "code"]) {
    expect(serialized.toLowerCase()).not.toContain(leaked);
  }
}

describe("Google flow under the allowlist", () => {
  it("enabled company permits Google sign-in with company-scoped identity", async () => {
    const email = `${RUN}-newbie@example.test`;
    const first = await request(app).post("/api/v1/auth/google").set("Host", hostA()).send({ idToken: googleToken(email) });
    expect(first.status).toBe(200);
    createdUserIds.push(first.body.data.user.id);
    expect(first.body.data.user).toMatchObject({ email });

    const stored = await prisma.user.findUnique({
      where: { id: first.body.data.user.id },
      select: { companyId: true, roles: { select: { role: { select: { name: true } } } } },
    });
    expect(stored.companyId).toBe(ctx.companyA.id);
    expect(stored.roles.map((link) => link.role.name)).toEqual(["CUSTOMER"]);

    // Same identity links again — no duplicate row.
    const second = await request(app).post("/api/v1/auth/google").set("Host", hostA()).send({ idToken: googleToken(email) });
    expect(second.status).toBe(200);
    expect(second.body.data.user.id).toBe(first.body.data.user.id);
    expect(await prisma.user.count({ where: { email, companyId: ctx.companyA.id } })).toBe(1);
  });

  it("disabled company fails closed without creating or touching anyone", async () => {
    const email = `${RUN}-blocked@example.test`;
    const usersBefore = await prisma.user.count({ where: { email } });
    await setGoogleSignIn(ctx.companyA.id, false);
    try {
      const res = await request(app).post("/api/v1/auth/google").set("Host", hostA()).send({ idToken: googleToken(email) });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_GOOGLE_NOT_ALLOWED");
      expect(await prisma.user.count({ where: { email } })).toBe(usersBefore);

      // An existing company customer is untouched and keeps password login.
      const login = await request(app).post("/api/v1/auth/login").send({ email: ctx.customerA.email, password: PASSWORD });
      expect(login.status).toBe(200);
      const stored = await prisma.user.findUnique({ where: { id: ctx.customerA.id }, select: { isActive: true, companyId: true } });
      expect(stored).toMatchObject({ isActive: true, companyId: ctx.companyA.id });
    } finally {
      await setGoogleSignIn(ctx.companyA.id, true);
    }
  });

  it("same email in two companies never cross-authenticates", async () => {
    const shared = `${RUN}-shared@example.test`;
    for (const companyId of [ctx.companyA.id, ctx.companyB.id]) {
      // eslint-disable-next-line no-await-in-loop
      const customer = await prisma.user.create({
        data: {
          email: shared,
          passwordHash: await hashPassword(PASSWORD),
          firstName: "Shared",
          companyId,
        },
      });
      createdUserIds.push(customer.id);
      let role = await prisma.role.findUnique({ where: { name: "CUSTOMER" } });
      if (!role) {
        // eslint-disable-next-line no-await-in-loop
        role = await prisma.role.create({ data: { name: "CUSTOMER" } });
      }
      // eslint-disable-next-line no-await-in-loop
      await prisma.userRole.create({ data: { userId: customer.id, roleId: role.id } });
    }
    await setGoogleSignIn(ctx.companyA.id, false);
    try {
      const denied = await request(app).post("/api/v1/auth/google").set("Host", hostA()).send({ idToken: googleToken(shared) });
      expect(denied.status).toBe(403);

      const allowed = await request(app).post("/api/v1/auth/google").set("Host", hostB()).send({ idToken: googleToken(shared) });
      expect(allowed.status).toBe(200);
      const stored = await prisma.user.findUnique({ where: { id: allowed.body.data.user.id }, select: { companyId: true } });
      expect(stored.companyId).toBe(ctx.companyB.id);
    } finally {
      await setGoogleSignIn(ctx.companyA.id, true);
    }
  });

  it("staff linking follows the company flag uniformly", async () => {
    const allowed = await request(app).post("/api/v1/auth/google").set("Host", hostA()).send({ idToken: googleToken(ctx.adminA.email) });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.user.id).toBe(ctx.adminA.id);

    await setGoogleSignIn(ctx.companyA.id, false);
    try {
      const denied = await request(app).post("/api/v1/auth/google").set("Host", hostA()).send({ idToken: googleToken(ctx.adminA.email) });
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe("AUTH_GOOGLE_NOT_ALLOWED");
    } finally {
      await setGoogleSignIn(ctx.companyA.id, true);
    }
  });

  it("unscoped legacy flow ignores company flags", async () => {
    await setGoogleSignIn(ctx.companyA.id, false);
    try {
      const res = await request(app).post("/api/v1/auth/google").send({ idToken: googleToken(ctx.superAdmin.email) });
      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(ctx.superAdmin.id);
    } finally {
      await setGoogleSignIn(ctx.companyA.id, true);
    }
  });

  it("suspended company stays blocked even when Google is enabled", async () => {
    const suspended = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/suspend`).set(superHeaders());
    expect(suspended.status).toBe(200);
    try {
      const res = await request(app).post("/api/v1/auth/google").set("Host", hostA()).send({ idToken: googleToken(`${RUN}-susp@example.test`) });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
      expect(await prisma.user.count({ where: { email: `${RUN}-susp@example.test` } })).toBe(0);
    } finally {
      const restored = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/restore`).set(superHeaders());
      expect(restored.status).toBe(200);
    }
  });

  it("deactivated domain resolves nothing for the deleted company", async () => {
    const domains = await request(app).get(`/api/v1/companies/${ctx.companyA.id}/domains`).set(superHeaders());
    const row = domains.body.data.domains.find((entry) => entry.domain === hostA());
    const off = await request(app).patch(`/api/v1/companies/${ctx.companyA.id}/domains/${row.id}`).set(superHeaders()).send({ isActive: false });
    expect(off.status).toBe(200);
    try {
      const email = `${RUN}-parked@example.test`;
      const res = await request(app).post("/api/v1/auth/google").set("Host", hostA()).send({ idToken: googleToken(email) });
      expect(res.status).toBe(200);
      // Legacy fallback: never stamped with the parked company.
      const stored = await prisma.user.findUnique({ where: { id: res.body.data.user.id }, select: { companyId: true } });
      expect(stored.companyId).not.toBe(ctx.companyA.id);
      createdUserIds.push(res.body.data.user.id);
    } finally {
      await request(app).patch(`/api/v1/companies/${ctx.companyA.id}/domains/${row.id}`).set(superHeaders()).send({ isActive: true });
    }
  });

  it("password login is unchanged by the allowlist", async () => {
    const before = await request(app).post("/api/v1/auth/login").send({ email: ctx.customerA.email, password: PASSWORD });
    expect(before.status).toBe(200);
    await setGoogleSignIn(ctx.companyA.id, false);
    try {
      const during = await request(app).post("/api/v1/auth/login").send({ email: ctx.customerA.email, password: PASSWORD });
      expect(during.status).toBe(200);
    } finally {
      await setGoogleSignIn(ctx.companyA.id, true);
    }
  });
});
