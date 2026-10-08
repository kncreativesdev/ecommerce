import { describe, it, expect } from "vitest";
import request from "supertest";

import app from "../../src/app.js";

/**
 * Password-recovery limiter cap (live app, isolated worker → isolated
 * in-memory limiter state; kept in its own file because the recovery
 * endpoints share one budget and would otherwise poison the counts of
 * the functional suites).
 *
 * AUTH_RATE_LIMIT_MAX=30 → attempts 1..30 answered normally, 31st 429s.
 */

describe("password recovery rate limiter", () => {
  it("answers 30 initiation attempts normally, then 429s", async () => {
    const email = `budget-${Date.now().toString(36)}@example.test`;
    let last = null;
    for (let attempt = 1; attempt <= 31; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await request(app).post("/api/v1/auth/forgot-password").send({ email });
      if (attempt <= 30) {
        expect(last.status).toBe(200);
      }
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  }, 60000);
});
