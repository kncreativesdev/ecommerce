import { describe, it, expect } from "vitest";
import request from "supertest";

import app from "../../src/app.js";

/**
 * Refresh limiter cap (live app, isolated worker → isolated in-memory
 * limiter state; kept in its own file because register/login share the
 * login limiter budget and would otherwise poison the counts).
 *
 * The refresh limiter counts every attempt (success or failure):
 * AUTH_RATE_LIMIT_MAX=30 → attempts 1..30 return 200, the 31st 429s, so
 * a refresh storm cannot run forever.
 */

describe("refresh rate limiter", () => {
  it("caps total refresh attempts (successes included) at the max", async () => {
    const email = `budget-${Date.now().toString(36)}@example.test`;
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "TestPass123!", firstName: "Budget", lastName: "Probe" });
    expect(registered.status).toBe(201);
    const loggedIn = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "TestPass123!" });
    expect(loggedIn.status).toBe(200);
    const cookie = (loggedIn.headers["set-cookie"] || []).find((c) => c.startsWith("refresh_token="));
    expect(cookie).toMatch(/^refresh_token=.+/);
    const jar = cookie.split(";")[0];

    let last = null;
    for (let attempt = 1; attempt <= 31; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await request(app).post("/api/v1/auth/refresh").set("Cookie", jar);
      if (attempt <= 30) {
        expect(last.status).toBe(200);
      }
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  }, 60000);
});
