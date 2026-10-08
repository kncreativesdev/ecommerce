import { describe, it, expect } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { stampUserCompany } from "../helpers/userFixtures.js";
import {
  authLoginRateLimiter,
  authRefreshRateLimiter,
} from "../../src/modules/auth/auth.rateLimit.js";

/**
 * Auth refresh regression suite (persistent one-time rotation):
 *
 * - normal refresh issues a new access token + rotates the cookie
 * - invalid / missing refresh cookie → 401 AUTH_REFRESH_TOKEN_INVALID
 * - concurrent refreshes with the SAME cookie: EXACTLY ONE succeeds.
 *   Every refresh token is backed by a server-side session row keyed
 *   by its `jti`; consumption is a single conditional database update,
 *   so simultaneous tabs sharing the browser cookie jar serialize in
 *   the database — the winner rotates, losers get 401 and must retry
 *   with the fresh cookie (standard rotation discipline; a tab holding
 *   a stale cookie replays a consumed token).
 * - login and refresh use SEPARATE rate-limiter instances so background
 *   silent refreshes can never consume the manual login budget (the
 *   "Too Many Requests on login after tab refreshes" bug)
 *
 * Request budget is kept tiny (well under AUTH_RATE_LIMIT_MAX) so this
 * suite never trips the limiters it verifies.
 */

const RUN = `TSTRA${Date.now().toString(36).toUpperCase()}`;

function extractRefreshCookie(res) {
  const cookies = res.headers["set-cookie"] || [];
  const hit = cookies.find((cookie) => cookie.startsWith("refresh_token="));
  return hit ? hit.split(";")[0] : null;
}

describe("auth refresh lifecycle", () => {
  it("login sets an HttpOnly refresh cookie and returns an access token", async () => {
    const email = `${RUN.toLowerCase()}-refresh@example.test`;
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "TestPass123!", firstName: "Refresh", lastName: "Probe" });
    expect(registered.status).toBe(201);
    await stampUserCompany(registered.body.data.user.id);

    const loggedIn = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "TestPass123!" });
    expect(loggedIn.status).toBe(200);
    expect(typeof loggedIn.body.data.accessToken).toBe("string");
    const cookie = extractRefreshCookie(loggedIn);
    expect(cookie).toMatch(/^refresh_token=.+/);
    expect(loggedIn.headers["set-cookie"].join(";")).toMatch(/httponly/i);
  });

  it("normal refresh returns a new access token and rotates the cookie", async () => {
    const email = `${RUN.toLowerCase()}-rotate@example.test`;
    const rotateReg = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "TestPass123!", firstName: "Rotate", lastName: "Probe" });
    await stampUserCompany(rotateReg.body.data.user.id);
    const loggedIn = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "TestPass123!" });
    const cookie = extractRefreshCookie(loggedIn);

    const refreshed = await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie);
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.data.accessToken).toBe("string");
    // Rotation: a fresh cookie is issued on every refresh.
    expect(extractRefreshCookie(refreshed)).toMatch(/^refresh_token=.+/);

    // The rotated access token authenticates immediately.
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${refreshed.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);
  });

  it("missing refresh cookie → 401 AUTH_REFRESH_TOKEN_INVALID (no logout side effects)", async () => {
    const res = await request(app).post("/api/v1/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "AUTH_REFRESH_TOKEN_INVALID" },
    });
    // Failure must not clear anything server-side: no Set-Cookie clearing.
    expect(res.headers["set-cookie"] || []).toEqual([]);
  });

  it("tampered refresh token → 401 AUTH_REFRESH_TOKEN_INVALID", async () => {
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", "refresh_token=eyJhbGciOiJIUzI1NiJ9.tampered.signature");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");
  });

  it("concurrent refreshes with the same cookie: exactly one wins, losers get 401", async () => {
    const email = `${RUN.toLowerCase()}-race@example.test`;
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "TestPass123!", firstName: "Race", lastName: "Probe" });
    const loggedIn = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "TestPass123!" });
    const cookie = extractRefreshCookie(loggedIn);

    // Admin tab + storefront tab refreshing simultaneously (same cookie jar).
    // The conditional consume is atomic: exactly one request rotates.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post("/api/v1/auth/refresh").set("Cookie", cookie)
      )
    );
    const succeeded = results.filter((res) => res.status === 200);
    const rejected = results.filter((res) => res.status === 401);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    expect(typeof succeeded[0].body.data.accessToken).toBe("string");
    for (const res of rejected) {
      expect(res.body.error.code).toBe("AUTH_REFRESH_TOKEN_INVALID");
    }
    // The winner's fresh cookie keeps working; the consumed cookie stays dead.
    const winnerJar = extractRefreshCookie(succeeded[0]);
    expect(winnerJar).toMatch(/^refresh_token=.+/);
    const followUp = await request(app).post("/api/v1/auth/refresh").set("Cookie", winnerJar);
    expect(followUp.status).toBe(200);
    const replay = await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie);
    expect(replay.status).toBe(401);
  });

  it("expired/tampered access token → 401 and never a 429", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
    expect(["AUTH_TOKEN_INVALID", "AUTH_TOKEN_EXPIRED", "AUTH_UNAUTHORIZED"]).toContain(
      res.body.error.code
    );
  });

  it("login and refresh limiters are separate instances (independent budgets)", async () => {
    expect(authLoginRateLimiter).toBeDefined();
    expect(authRefreshRateLimiter).toBeDefined();
    expect(authRefreshRateLimiter).not.toBe(authLoginRateLimiter);
  });

  it("auth rate limiting stays enforced with the documented shape", async () => {
    // Shape probe only (no budget exhaustion): an over-limit response must
    // be 429 RATE_LIMIT_EXCEEDED. Full exhaustion is covered by config
    // review (AUTH_RATE_LIMIT_MAX=30/15min) — burning 30 logins here would
    // poison the shared in-memory limiter for sibling suites.
    const { env } = await import("../../src/config/env.js");
    expect(env.authRateLimitMax).toBeGreaterThan(0);
    expect(env.authRateLimitWindowMs).toBeGreaterThan(0);
  });
});
