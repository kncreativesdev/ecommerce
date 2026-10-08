import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { clearGoogleCertsCache } from "../../src/modules/auth/auth.google.js";
import { prisma } from "../../src/config/database.js";
import { companyOneAdminId, stampUserCompany } from "../helpers/userFixtures.js";
import { createRequire } from "module";

// NOTE: backend sources load through native `require()` (CommonJS), which
// resolves to a different module instance than the test's `import` graph —
// mutating the imported `env` object (or `vi.mock`-ing it) is invisible to
// the service. The native instance below IS the one the app uses, so the
// client ID is injected through it.
const nativeRequire = createRequire(import.meta.url);
const nativeEnv = nativeRequire("../../src/config/env.js").env;

/**
 * Google sign-in (POST /auth/google, live MySQL + mocked Google certs):
 * - 503 AUTH_GOOGLE_NOT_CONFIGURED when no client ID is configured.
 * - 422 on missing idToken; 401 AUTH_GOOGLE_INVALID_TOKEN on malformed,
 *   wrong-audience, expired, unverified, or badly-signed tokens.
 * - A valid token mints the standard session (user + accessToken +
 *   refresh cookie): new verified emails get a CUSTOMER account,
 *   existing emails link to the same account, inactive accounts get 403.
 *
 * Google's JWKS endpoint is stubbed with a generated RSA keypair — no
 * network, no real Google credentials. Signing uses Node crypto only.
 */

const RUN = `TSTGO${Date.now().toString(36).toUpperCase()}`;
const CLIENT_ID = "test-google-client.apps.googleusercontent.com";
const COMPANY_ONE_ADMIN_ID = await companyOneAdminId();
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: COMPANY_ONE_ADMIN_ID, roles: ["ADMIN"] })}` });

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

function validPayload(email) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "accounts.google.com",
    aud: CLIENT_ID,
    exp: now + 3600,
    iat: now,
    email,
    email_verified: true,
    given_name: "Google",
    family_name: "Tester",
  };
}

const realClientId = nativeEnv.googleClientId;

function stubGoogleCerts() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [PUBLIC_JWK] }),
    })
  );
}

beforeAll(() => {
  nativeEnv.googleClientId = CLIENT_ID;
  stubGoogleCerts();
});

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
  await prisma.$disconnect();
});

describe("POST /auth/google", () => {
  it("answers 503 when Google sign-in is not configured", async () => {
    nativeEnv.googleClientId = "";
    const res = await request(app).post("/api/v1/auth/google").send({ idToken: "anything" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AUTH_GOOGLE_NOT_CONFIGURED");
    nativeEnv.googleClientId = CLIENT_ID;
  });

  it("validates the request body", async () => {
    const missing = await request(app).post("/api/v1/auth/google").send({});
    expect(missing.status).toBe(422);

    const empty = await request(app).post("/api/v1/auth/google").send({ idToken: "  " });
    expect(empty.status).toBe(422);
  });

  it("rejects malformed tokens", async () => {
    const res = await request(app).post("/api/v1/auth/google").send({ idToken: "not-a-jwt" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_GOOGLE_INVALID_TOKEN");
  });

  it("rejects tokens for a different audience", async () => {
    const token = signIdToken({ ...validPayload(`${RUN.toLowerCase()}-aud@example.test`), aud: "other-client" });
    const res = await request(app).post("/api/v1/auth/google").send({ idToken: token });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_GOOGLE_INVALID_TOKEN");
  });

  it("rejects expired tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signIdToken({ ...validPayload(`${RUN.toLowerCase()}-exp@example.test`), exp: now - 3600, iat: now - 7200 });
    const res = await request(app).post("/api/v1/auth/google").send({ idToken: token });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_GOOGLE_INVALID_TOKEN");
  });

  it("rejects unverified emails", async () => {
    const token = signIdToken({ ...validPayload(`${RUN.toLowerCase()}-unv@example.test`), email_verified: false });
    const res = await request(app).post("/api/v1/auth/google").send({ idToken: token });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_GOOGLE_INVALID_TOKEN");
  });

  it("rejects badly-signed tokens", async () => {
    const token = signIdToken(validPayload(`${RUN.toLowerCase()}-sig@example.test`));
    const tampered = `${token.slice(0, -4)}AAAA`;
    const res = await request(app).post("/api/v1/auth/google").send({ idToken: tampered });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_GOOGLE_INVALID_TOKEN");
  });

  it("creates a CUSTOMER account and mints the standard session for new emails", async () => {
    const email = `${RUN.toLowerCase()}-new@example.test`;
    const res = await request(app).post("/api/v1/auth/google").send({ idToken: signIdToken(validPayload(email)) });
    expect(res.status).toBe(200);
    await stampUserCompany(res.body.data.user.id);
    expect(res.body.data.user).toMatchObject({ email, firstName: "Google", lastName: "Tester" });
    expect(res.body.data.user.roles).toContain("CUSTOMER");
    expect(res.body.data.accessToken).toBeTruthy();
    const cookies = res.headers["set-cookie"]?.join(";") ?? "";
    expect(cookies).toContain("refresh_token");

    // The session is real: /me resolves with the bearer token.
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set({ Authorization: `Bearer ${res.body.data.accessToken}` });
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);
  });

  it("links repeat sign-ins to the same account", async () => {
    const email = `${RUN.toLowerCase()}-repeat@example.test`;
    const first = await request(app).post("/api/v1/auth/google").send({ idToken: signIdToken(validPayload(email)) });
    expect(first.status).toBe(200);
    const second = await request(app).post("/api/v1/auth/google").send({ idToken: signIdToken(validPayload(email)) });
    expect(second.status).toBe(200);
    expect(second.body.data.user.id).toBe(first.body.data.user.id);
  });

  it("links an existing password account by verified email", async () => {
    const email = `${RUN.toLowerCase()}-link@example.test`;
    const registered = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "TestPass123!",
      firstName: "Password",
      lastName: "User",
    });
    expect(registered.status).toBe(201);
    await stampUserCompany(registered.body.data.user.id);

    const res = await request(app).post("/api/v1/auth/google").send({ idToken: signIdToken(validPayload(email)) });
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(registered.body.data.user.id);
  });

  it("blocks inactive accounts like password login does", async () => {
    const email = `${RUN.toLowerCase()}-inactive@example.test`;
    const first = await request(app).post("/api/v1/auth/google").send({ idToken: signIdToken(validPayload(email)) });
    expect(first.status).toBe(200);
    // Legitimate company customer: the admin deactivation below is
    // company-scoped, so the fixture must resolve.
    await stampUserCompany(first.body.data.user.id);

    const deactivated = await request(app)
      .patch(`/api/v1/users/${first.body.data.user.id}`)
      .set(adminHeaders())
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);

    const res = await request(app).post("/api/v1/auth/google").send({ idToken: signIdToken(validPayload(email)) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_ACCOUNT_INACTIVE");
  });
});
