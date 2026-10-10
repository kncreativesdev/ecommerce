import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { env } from "../../src/config/env.js";
import { signAccessToken, signRefreshToken } from "../../src/utils/jwt.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Refresh-token hardening matrix (live HTTP + MySQL).
 *
 * The rotation suite proves persistence, rotation, replay rejection,
 * logout revocation, and 5/10-way exactly-once races. This file pins
 * the remaining input shapes and the literal two-consumer race:
 *
 * - expired refresh JWT (past `exp`, valid signature) → 401, no rotation
 * - malformed cookies (garbage, empty, tampered) → 401, no rotation
 * - access token presented as a refresh token → 401 (wrong secret)
 * - validly-signed token with no server session → 401 (persistence mandatory)
 * - revoked session stays rejected; logout stays idempotent 200
 * - exactly two concurrent refreshes with the same cookie: one 200,
 *   one 401; the winner's successor works and the old token stays dead
 *
 * Budget: 2 logins + ~11 refresh attempts, well under the shared AUTH
 * limits (30/15min per limiter; this file runs in its own worker with
 * isolated in-memory limiter state).
 */

const RUN = `TSTHR${Date.now().toString(36).toUpperCase()}`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

function jarOf(res) {
  const hit = (res.headers["set-cookie"] || []).find((c) => c.startsWith("refresh_token="));
  expect(hit).toMatch(/^refresh_token=.+/);
  return hit.split(";")[0];
}

function hasRefreshCookie(res) {
  return (res.headers["set-cookie"] || []).some((c) => c.startsWith("refresh_token="));
}

async function login(email, password) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res;
}

function expectInvalidRefresh(res) {
  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");
  // Failure must never rotate: no fresh cookie is issued.
  expect(hasRefreshCookie(res)).toBe(false);
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `${RUN}-co` } });
  createdCompanyIds.push(company.id);
  const user = await prisma.user.create({
    data: {
      email: `${RUN}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Harden",
      lastName: "Probe",
      companyId: company.id,
    },
  });
  createdUserIds.push(user.id);
  let role = await prisma.role.findUnique({ where: { name: "CUSTOMER" } });
  if (!role) {
    role = await prisma.role.create({ data: { name: "CUSTOMER" } });
  }
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  ctx.user = user;
}, 120000);

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

describe("refresh token shape matrix", () => {
  it("expired refresh JWT (valid signature, past exp) is rejected without rotation", async () => {
    const expired = jwt.sign({ sub: ctx.user.id, jti: randomUUID() }, env.jwtRefreshSecret, {
      expiresIn: "-10s",
    });
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${expired}`);
    expectInvalidRefresh(res);
  });

  it.each([["garbage"], ["empty"], ["tampered"]])(
    "malformed refresh cookie (%s) is rejected without rotation",
    async (kind) => {
      const value =
        kind === "garbage"
          ? "not-a-jwt"
          : kind === "empty"
            ? ""
            : "eyJhbGciOiJIUzI1NiJ9.tampered.signature";
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .set("Cookie", `refresh_token=${value}`);
      expectInvalidRefresh(res);
    }
  );

  it("access token presented as a refresh token is rejected (wrong secret)", async () => {
    const access = signAccessToken({ id: ctx.user.id, roles: ["CUSTOMER"] });
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${access}`);
    expectInvalidRefresh(res);
  });

  it("validly-signed refresh token with no server session is rejected", async () => {
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${signRefreshToken(ctx.user.id)}`);
    expectInvalidRefresh(res);
  });

  it("revoked session stays rejected and logout stays idempotent", async () => {
    const loggedIn = await login(`${RUN}@example.test`, "TestPass123!");
    const jar = jarOf(loggedIn);

    const out = await request(app).post("/api/v1/auth/logout").set("Cookie", jar);
    expect(out.status).toBe(200);
    expect(out.body.data).toEqual({ message: "Logged out successfully" });

    expectInvalidRefresh(await request(app).post("/api/v1/auth/refresh").set("Cookie", jar));

    // Second logout of the same (now revoked) token is still 200.
    const again = await request(app).post("/api/v1/auth/logout").set("Cookie", jar);
    expect(again.status).toBe(200);
  });
});

describe("two concurrent refreshes with the same token", () => {
  it("exactly one wins; the winner rotates and the old token stays dead", async () => {
    const loggedIn = await login(`${RUN}@example.test`, "TestPass123!");
    const jar = jarOf(loggedIn);

    const [first, second] = await Promise.all([
      request(app).post("/api/v1/auth/refresh").set("Cookie", jar),
      request(app).post("/api/v1/auth/refresh").set("Cookie", jar),
    ]);
    const succeeded = [first, second].filter((res) => res.status === 200);
    const rejected = [first, second].filter((res) => res.status === 401);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");

    // The winner's successor session works (no replay restored it).
    const followUp = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", jarOf(succeeded[0]));
    expect(followUp.status).toBe(200);

    // The consumed token stays dead.
    expectInvalidRefresh(await request(app).post("/api/v1/auth/refresh").set("Cookie", jar));
  });
});
