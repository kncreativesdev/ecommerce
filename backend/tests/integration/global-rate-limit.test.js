import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { COMPANY_ONE_ID } from "../helpers/userFixtures.js";

/**
 * Global baseline limiter semantics (live app, isolated worker):
 *
 * - successful requests do NOT consume the budget
 *   (`skipSuccessfulRequests`): normal browsing — ~10 successful calls per
 *   page load, two tabs sharing one IP — must never 429 legitimate use or
 *   stack onto `/auth/login` and lock users out after repeated refreshes.
 * - failed requests still do: probes/fuzzing continue to be throttled.
 *
 * RATE_LIMIT_MAX=100 → 110 successes all 200; then 100 failures answered
 * 404 and the 101st 429s.
 *
 * Phase 2C-26: public reads fail closed on unregistered hosts (a 404
 * would consume budget and skew both tests), so the success loop
 * resolves Company #1 through an explicit RUN-unique test domain
 * instead of ambient localhost state.
 */

const PUBLIC_HOST = `tstrl-public-${Date.now().toString(36).toLowerCase()}.example.test`;
let publicDomainId = null;

beforeAll(async () => {
  const row = await prisma.companyDomain.create({
    data: { companyId: COMPANY_ONE_ID, domain: PUBLIC_HOST, isPrimary: false, isActive: true },
  });
  publicDomainId = row.id;
}, 120000);

afterAll(async () => {
  if (publicDomainId) {
    await prisma.companyDomain.deleteMany({ where: { id: publicDomainId } });
  }
  await prisma.$disconnect();
});

describe("global rate limiter", () => {
  it("does not count successful requests against the budget", async () => {
    for (let i = 1; i <= 110; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).get("/api/v1/announcements/current").set("Host", PUBLIC_HOST);
      expect(res.status).toBe(200);
    }
  }, 120000);

  it("still throttles failure floods", async () => {
    let last = null;
    for (let i = 1; i <= 101; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await request(app).get("/api/v1/this-route-does-not-exist");
      if (i <= 100) {
        expect(last.status).toBe(404);
      }
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  }, 120000);
});
