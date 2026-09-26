import { describe, it, expect } from "vitest";
import request from "supertest";

import app from "../../src/app.js";

/**
 * Auth limiter boundaries (live app, isolated worker → isolated
 * in-memory limiter state):
 *
 * - login limiter counts every attempt and 429s past the max, proving
 *   credential-brute-force protection is intact after the login/refresh
 *   split and after `skipSuccessfulRequests` was scoped to the global
 *   limiter only.
 * - refresh limiter likewise still caps total attempts (success or
 *   failure): a refresh storm cannot run forever.
 *
 * AUTH_RATE_LIMIT_MAX=30 → attempts 1..30 answered normally, 31st 429s.
 *
 * NOTE: register shares the login limiter budget, so the refresh-cap
 * proof lives in refresh-rate-limit.test.js (separate worker process →
 * separate in-memory limiter state).
 */

const FAKE_EMAIL = `ghost-${Date.now().toString(36)}@example.test`;

describe("login rate limiter", () => {
  it("answers 30 credential failures normally, then 429s (protection intact)", async () => {
    let last = null;
    for (let attempt = 1; attempt <= 31; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: FAKE_EMAIL, password: "WrongPass123!" });
      if (attempt <= 30) {
        expect(last.status).toBe(401);
        expect(last.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
      }
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  }, 60000);
});
