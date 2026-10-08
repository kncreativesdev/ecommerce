import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import {
  resolvePublicCompanyContext,
  getCompanyContext,
} from "../../src/middleware/companyContext.js";
import { COMPANY_ONE_ID } from "../helpers/userFixtures.js";

/**
 * Phase 2C-11 domain → company runtime resolution (live MySQL).
 *
 * Dedicated companies A (two active domains + one inactive) and B, plus
 * a suspended company S, all under RUN-unique hostnames. Covers live
 * middleware attachment, identity precedence, registration assignment,
 * and public-route passthrough. Company #1 is read-only.
 */

const RUN = `TSTDR${Date.now().toString(36).toUpperCase()}`.toLowerCase();

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];
const createdDomainIds = [];

function hostReq(host, existing) {
  const req = {
    get: (name) => (String(name).toLowerCase() === "host" ? host : undefined),
    headers: {},
  };
  if (existing !== undefined) {
    req.companyContext = existing;
  }
  return req;
}

function runMiddleware(req) {
  return new Promise((resolve) => {
    resolvePublicCompanyContext(req, {}, (err) => resolve(err));
  });
}

async function addDomain(companyId, domain, extra = {}) {
  const row = await prisma.companyDomain.create({
    data: { companyId, domain, isPrimary: false, isActive: true, ...extra },
  });
  createdDomainIds.push(row.id);
  return row;
}

beforeAll(async () => {
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
  }
  await addDomain(ctx.companyA.id, `${RUN}-shop-a.example.test`, { isPrimary: true });
  await addDomain(ctx.companyA.id, `${RUN}-alias-a.example.test`);
  await addDomain(ctx.companyA.id, `${RUN}-old-a.example.test`, { isActive: false });
  await addDomain(ctx.companyB.id, `${RUN}-shop-b.example.test`, { isPrimary: true });
  await addDomain(ctx.companyS.id, `${RUN}-shop-s.example.test`, { isPrimary: true });
}, 120000);

afterAll(async () => {
  if (createdDomainIds.length > 0) {
    await prisma.companyDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

describe("live domain resolution", () => {
  it("active registered domain resolves the correct company", async () => {
    const req = hostReq(`${RUN}-shop-a.example.test`);
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.companyContext).toMatchObject({
      companyId: ctx.companyA.id,
      isPlatformContext: false,
      source: "domain",
    });
    expect(req.companyContext.company.status).toBe("ACTIVE");
  });

  it("normalizes case, trailing dots, and local ports before lookup", async () => {
    for (const host of [
      `${RUN}-SHOP-A.EXAMPLE.TEST`,
      `${RUN}-shop-a.example.test.`,
      `${RUN}-shop-a.example.test:3000`,
    ]) {
      const req = hostReq(host);
      const err = await runMiddleware(req);
      expect(err).toBeUndefined();
      expect(req.companyContext?.companyId).toBe(ctx.companyA.id);
    }
  });

  it("two domains resolve the same company; different domains resolve different companies", async () => {
    const alias = hostReq(`${RUN}-alias-a.example.test`);
    expect(await runMiddleware(alias)).toBeUndefined();
    expect(alias.companyContext.companyId).toBe(ctx.companyA.id);
    const other = hostReq(`${RUN}-shop-b.example.test`);
    expect(await runMiddleware(other)).toBeUndefined();
    expect(other.companyContext.companyId).toBe(ctx.companyB.id);
  });

  it("unknown, inactive, and malformed hosts attach nothing and never fail", async () => {
    for (const host of [
      `${RUN}-nope.example.test`,
      `${RUN}-old-a.example.test`,
      "",
      "https://evil.example.com",
      "35b5a215-0cf3-42db-ba42-6fac6656a708",
    ]) {
      const req = hostReq(host);
      const err = await runMiddleware(req);
      expect(err).toBeUndefined();
      expect(getCompanyContext(req)).toBeNull();
    }
  });

  it("never overwrites an existing (identity/platform) context", async () => {
    const existing = { companyId: ctx.companyB.id, company: null, isPlatformContext: false, source: "identity" };
    const req = hostReq(`${RUN}-shop-a.example.test`, existing);
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.companyContext).toBe(existing);
    const platform = { companyId: null, company: null, isPlatformContext: true, source: "platform" };
    const reqSuper = hostReq(`${RUN}-shop-a.example.test`, platform);
    expect(await runMiddleware(reqSuper)).toBeUndefined();
    expect(reqSuper.companyContext).toBe(platform);
  });

  it("suspended company status is exposed without blocking", async () => {
    const req = hostReq(`${RUN}-shop-s.example.test`);
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.companyContext.companyId).toBe(ctx.companyS.id);
    expect(req.companyContext.company.status).toBe("SUSPENDED");
  });
});

describe("customer registration company assignment", () => {
  it("derives companyId from the registered domain", async () => {
    const email = `${RUN}-shopper@example.test`;
    const res = await request(app)
      .post("/api/v1/auth/register")
      .set("Host", `${RUN}-shop-a.example.test`)
      .send({ email, password: "TestPass123!", firstName: "Shopper" });
    expect(res.status).toBe(201);
    const stored = await prisma.user.findFirst({ where: { email }, select: { id: true, companyId: true } });
    expect(stored.companyId).toBe(ctx.companyA.id);
    createdUserIds.push(stored.id);
  });

  it("preserves legacy behavior on unregistered hosts", async () => {
    const email = `${RUN}-legacy@example.test`;
    const res = await request(app)
      .post("/api/v1/auth/register")
      .set("Host", `${RUN}-unregistered.example.test`)
      .send({
        email,
        password: "TestPass123!",
        firstName: "Legacy",
      });
    expect(res.status).toBe(201);
    const stored = await prisma.user.findFirst({ where: { email }, select: { id: true, companyId: true } });
    expect(stored.companyId).toBeNull();
    createdUserIds.push(stored.id);
  });

  it("ignores client-supplied companyId (stripped by validation)", async () => {
    const email = `${RUN}-nosmuggle@example.test`;
    const res = await request(app)
      .post("/api/v1/auth/register")
      .set("Host", `${RUN}-shop-a.example.test`)
      .send({ email, password: "TestPass123!", firstName: "No", companyId: ctx.companyB.id });
    expect(res.status).toBe(201);
    const stored = await prisma.user.findFirst({ where: { email }, select: { id: true, companyId: true } });
    expect(stored.companyId).toBe(ctx.companyA.id);
    createdUserIds.push(stored.id);
  });

  it("same email registers independently in different companies (Phase 2C-26)", async () => {
    const email = `${RUN}-dupe@example.test`;
    const first = await request(app)
      .post("/api/v1/auth/register")
      .set("Host", `${RUN}-shop-a.example.test`)
      .send({ email, password: "TestPass123!", firstName: "Dupe" });
    expect(first.status).toBe(201);
    createdUserIds.push(first.body.data.user.id);
    // Same email on another company's domain is a separate account,
    // not a conflict.
    const second = await request(app)
      .post("/api/v1/auth/register")
      .set("Host", `${RUN}-shop-b.example.test`)
      .send({ email, password: "TestPass123!", firstName: "Dupe" });
    expect(second.status).toBe(201);
    createdUserIds.push(second.body.data.user.id);
    expect(second.body.data.user.id).not.toBe(first.body.data.user.id);
    // Same email on the SAME company's domain stays rejected.
    const third = await request(app)
      .post("/api/v1/auth/register")
      .set("Host", `${RUN}-shop-a.example.test`)
      .send({ email, password: "TestPass123!", firstName: "Dupe" });
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe("AUTH_EMAIL_ALREADY_EXISTS");
  });

  it("login still works for domain-assigned customers", async () => {
    const loggedIn = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: `${RUN}-shopper@example.test`, password: "TestPass123!" });
    expect(loggedIn.status).toBe(200);
    expect(typeof loggedIn.body.data.accessToken).toBe("string");
  });
});

describe("public storefront passthrough", () => {
  it("data routes keep working with registered and unregistered hosts", async () => {
    // Registered hosts keep serving (Company #1 data via localhost is
    // covered by the shared suites); unregistered hosts fail closed on
    // storefront reads since Phase 2C-12 (no company → no catalog data).
    for (const path of ["/api/v1/categories", "/api/v1/products", "/api/v1/announcements/current"]) {
      const open = await request(app).get(path).set("Host", `${RUN}-shop-a.example.test`);
      expect(open.status).toBe(200);
      const closed = await request(app).get(path).set("Host", `${RUN}-unregistered.example.test`);
      expect(closed.status).toBe(404);
    }
  });

  it("Company #1 fixture data is untouched", async () => {
    const company = await prisma.company.findUnique({
      where: { id: COMPANY_ONE_ID },
      select: { id: true, name: true },
    });
    expect(company?.name).toBe("Tech Pulse");
  });
});
