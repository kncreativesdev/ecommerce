import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";

import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { signRefreshToken } from "../../src/utils/jwt.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Persistent one-time refresh-token rotation (live HTTP + MySQL).
 *
 * Every issued refresh token has a MySQL-backed session row keyed by
 * SHA-256 of its `jti` (never the raw token). Refresh atomically
 * consumes the presented row before minting a successor, so a `jti`
 * succeeds exactly once even under concurrent use; logout revokes
 * instead of merely clearing the cookie. Rows survive process
 * restarts by construction (database state, no in-memory list).
 *
 * Budget: 6 logins + ~19 refresh attempts, well under the shared
 * AUTH limits (30/15min per limiter).
 */

const RUN = `TSTRR${Date.now().toString(36).toUpperCase()}`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

function jarOf(res) {
  const hit = (res.headers["set-cookie"] || []).find((c) => c.startsWith("refresh_token="));
  expect(hit).toMatch(/^refresh_token=.+/);
  return hit.split(";")[0];
}

function tokenOf(jar) {
  return jar.slice("refresh_token=".length);
}

function jtiOf(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).jti;
}

async function sessionRow(jar) {
  const jtiHash = createHash("sha256").update(jtiOf(tokenOf(jar)), "utf8").digest("hex");
  return prisma.refreshSession.findUnique({ where: { jtiHash } });
}

async function login(email, password) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res;
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `${RUN}-co` } });
  createdCompanyIds.push(company.id);
  ctx.companyId = company.id;
  for (const tag of ["a", "b"]) {
    const user = await prisma.user.create({
      data: {
        email: `${RUN}-${tag}@example.test`,
        passwordHash: await hashPassword("TestPass123!"),
        firstName: "Rotate",
        lastName: tag.toUpperCase(),
        companyId: company.id,
      },
    });
    createdUserIds.push(user.id);
    let role = await prisma.role.findUnique({ where: { name: "CUSTOMER" } });
    if (!role) {
      role = await prisma.role.create({ data: { name: "CUSTOMER" } });
    }
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    ctx[`user${tag.toUpperCase()}`] = user;
  }
}, 120000);

afterAll(async () => {
  if (createdUserIds.length > 0) {
    // Refresh sessions cascade with their users.
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

describe("refresh session persistence", () => {
  it("login persists exactly the session identifiers, never the raw token", async () => {
    const loggedIn = await login(`${RUN}-a@example.test`, "TestPass123!");
    const jar = jarOf(loggedIn);
    const raw = tokenOf(jar);
    const row = await sessionRow(jar);
    expect(row).not.toBeNull();
    expect(row.userId).toBe(ctx.userA.id);
    expect(row.revokedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(Object.keys(row).sort()).toEqual(
      ["createdAt", "expiresAt", "id", "jtiHash", "revokedAt", "userId"].sort()
    );
    expect(row.jtiHash).toMatch(/^[0-9a-f]{64}$/);
    // No raw token, secret, or hash material anywhere in the row.
    expect(JSON.stringify(row)).not.toContain(raw);
    expect(JSON.stringify(row)).not.toMatch(/password|secret|bearer|eyJ/i);
    ctx.jarA = jar;
  });

  it("refresh rotates once: successor works, replay of the old token fails", async () => {
    const rotated = await request(app).post("/api/v1/auth/refresh").set("Cookie", ctx.jarA);
    expect(rotated.status).toBe(200);
    expect(typeof rotated.body.data.accessToken).toBe("string");
    const jarB = jarOf(rotated);
    expect(tokenOf(jarB)).not.toBe(tokenOf(ctx.jarA));
    // The consumed row is revoked server-side.
    expect((await sessionRow(ctx.jarA)).revokedAt).not.toBeNull();

    const replay = await request(app).post("/api/v1/auth/refresh").set("Cookie", ctx.jarA);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");

    const followUp = await request(app).post("/api/v1/auth/refresh").set("Cookie", jarB);
    expect(followUp.status).toBe(200);
    ctx.jarLive = jarOf(followUp);

    // The rotated access token authorizes immediately (unchanged).
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${followUp.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(ctx.userA.id);
  });

  it("sessions are independent per user", async () => {
    const loggedInB = await login(`${RUN}-b@example.test`, "TestPass123!");
    const jarBu = jarOf(loggedInB);
    const rowB = await sessionRow(jarBu);
    expect(rowB.userId).toBe(ctx.userB.id);
    const ok = await request(app).post("/api/v1/auth/refresh").set("Cookie", jarBu);
    expect(ok.status).toBe(200);
    ctx.jarBu = jarOf(ok);
  });

  it("logout revokes the presented session; replay and reuse fail", async () => {
    expect((await sessionRow(ctx.jarLive)).revokedAt).toBeNull();
    const out = await request(app).post("/api/v1/auth/logout").set("Cookie", ctx.jarLive);
    expect(out.status).toBe(200);
    expect(out.body.data).toEqual({ message: "Logged out successfully" });
    expect((await sessionRow(ctx.jarLive)).revokedAt).not.toBeNull();

    const replay = await request(app).post("/api/v1/auth/refresh").set("Cookie", ctx.jarLive);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");

    // Anonymous logout stays 200 with no side effects.
    const anon = await request(app).post("/api/v1/auth/logout");
    expect(anon.status).toBe(200);

    // User B's session is untouched by user A's logout.
    const stillOk = await request(app).post("/api/v1/auth/refresh").set("Cookie", ctx.jarBu);
    expect(stillOk.status).toBe(200);
    ctx.jarBu = jarOf(stillOk);
  });

  it("expired sessions are rejected", async () => {
    const loggedIn = await login(`${RUN}-a@example.test`, "TestPass123!");
    const jar = jarOf(loggedIn);
    const row = await sessionRow(jar);
    await prisma.refreshSession.update({
      where: { id: row.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request(app).post("/api/v1/auth/refresh").set("Cookie", jar);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");
  });

  it("deactivated users cannot refresh with a live session", async () => {
    const loggedIn = await login(`${RUN}-a@example.test`, "TestPass123!");
    const jar = jarOf(loggedIn);
    await prisma.user.update({ where: { id: ctx.userA.id }, data: { isActive: false } });
    try {
      const res = await request(app).post("/api/v1/auth/refresh").set("Cookie", jar);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");
    } finally {
      await prisma.user.update({ where: { id: ctx.userA.id }, data: { isActive: true } });
    }
  });

  it("a validly-signed token with no server session is rejected", async () => {
    // Proves persistence is mandatory: signature + live ACTIVE user
    // are not sufficient without a session row.
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${signRefreshToken(ctx.userA.id)}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");
  });

  it("concurrent consumers of one jti produce exactly one success", async () => {
    const loggedIn = await login(`${RUN}-a@example.test`, "TestPass123!");
    const jar = jarOf(loggedIn);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post("/api/v1/auth/refresh").set("Cookie", jar))
    );
    const succeeded = results.filter((res) => res.status === 200);
    const rejected = results.filter((res) => res.status === 401);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const res of rejected) {
      expect(res.body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");
    }
    // One live successor session exists for the winner.
    const followUp = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", jarOf(succeeded[0]));
    expect(followUp.status).toBe(200);
  });

  it("suspended companies cannot refresh with a live session, then restore cleanly", async () => {
    const loggedIn = await login(`${RUN}-a@example.test`, "TestPass123!");
    const jar = jarOf(loggedIn);
    await prisma.company.update({ where: { id: ctx.companyId }, data: { status: "SUSPENDED" } });
    try {
      const blocked = await request(app).post("/api/v1/auth/refresh").set("Cookie", jar);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe("COMPANY_SUSPENDED");
    } finally {
      await prisma.company.update({ where: { id: ctx.companyId }, data: { status: "ACTIVE" } });
    }
    const ok = await request(app).post("/api/v1/auth/refresh").set("Cookie", jar);
    expect(ok.status).toBe(200);
  });
});
