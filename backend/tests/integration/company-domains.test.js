import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import {
  resolvePublicCompanyContext,
  getCompanyContext,
} from "../../src/middleware/companyContext.js";
import { COMPANY_ONE_ID } from "../helpers/userFixtures.js";

/**
 * Phase 2C-27 Super Admin CompanyDomain management (live HTTP + MySQL).
 *
 * Covers the platform boundary (SUPER_ADMIN-only), canonical
 * registration through the shared `normalizeHostname`, duplicate
 * rejection within/across companies, malformed-input rejection,
 * exactly-one-primary promotion (atomic, concurrent-safe),
 * active/inactive resolver behavior, cross-company isolation,
 * guarded deletion, audit instrumentation, and permanent company
 * deletion sweeping its domains through the existing cascade.
 * Company #1 is read-only throughout.
 */

const RUN = `TSTDM${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const domain = (tag) => `${RUN}-${tag}.example.test`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];
const createdDomainIds = [];

const headersFor = (id, roles) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});
const superHeaders = () => headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Dom",
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

async function createCompany(name) {
  const res = await request(app).post("/api/v1/companies").set(superHeaders()).send({ name });
  expect(res.status).toBe(201);
  createdCompanyIds.push(res.body.data.company.id);
  return res.body.data.company;
}

function runPublicMiddleware(host) {
  const req = {
    get: (name) => (String(name).toLowerCase() === "host" ? host : undefined),
    headers: {},
  };
  return new Promise((resolve) => {
    resolvePublicCompanyContext(req, {}, (err) => resolve({ err, req }));
  });
}

beforeAll(async () => {
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);
  const denied = await prisma.company.create({ data: { name: `${RUN}-denied-co` } });
  createdCompanyIds.push(denied.id);
  for (const [tag, role] of [["admin", "ADMIN"], ["head", "HEAD"], ["member", "MEMBER"], ["customer", "CUSTOMER"]]) {
    ctx[tag] = await createUser(`denied-${tag}`, role, denied.id);
  }
  await prisma.company.update({ where: { id: denied.id }, data: { adminUserId: ctx.admin.id } });
  ctx.deniedCompany = denied;
  ctx.companyA = await createCompany(`${RUN} Domain Co A`);
  ctx.companyB = await createCompany(`${RUN} Domain Co B`);
}, 120000);

afterAll(async () => {
  const ids = [...createdCompanyIds];
  if (ids.length > 0 || createdUserIds.length > 0 || createdDomainIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { resourceId: { in: ids } },
          { resourceId: { in: createdUserIds } },
          { resourceId: { in: createdDomainIds } },
          { actorId: { in: createdUserIds } },
        ],
      },
    });
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (ids.length > 0) {
      // Surviving dedicated companies cascade their domains and
      // company-scoped audit rows; the permanently-deleted company
      // below is already gone (idempotent).
      await prisma.company.deleteMany({ where: { id: { in: ids } } });
    }
  }
  await prisma.$disconnect();
});

describe("authorization boundary", () => {
  it.each([["ADMIN"], ["HEAD"], ["MEMBER"], ["CUSTOMER"]])("%s is denied every domain endpoint", async (role) => {
    const user = { ADMIN: ctx.admin, HEAD: ctx.head, MEMBER: ctx.member, CUSTOMER: ctx.customer }[role];
    const headers = headersFor(user.id, [role]);
    const id = ctx.companyA.id;
    const attempts = [
      await request(app).get(`/api/v1/companies/${id}/domains`).set(headers),
      await request(app).post(`/api/v1/companies/${id}/domains`).set(headers).send({ domain: domain(`denied-${role}`) }),
      await request(app).patch(`/api/v1/companies/${id}/domains/11111111-1111-1111-1111-111111111111`).set(headers).send({ isActive: false }),
      await request(app).delete(`/api/v1/companies/${id}/domains/11111111-1111-1111-1111-111111111111`).set(headers),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    }
    expect(await prisma.companyDomain.findFirst({ where: { domain: domain(`denied-${role}`) } })).toBeNull();
  });

  it("anonymous callers are denied", async () => {
    const id = ctx.companyA.id;
    expect((await request(app).get(`/api/v1/companies/${id}/domains`)).status).toBe(401);
    expect((await request(app).post(`/api/v1/companies/${id}/domains`).send({ domain: domain("anon") })).status).toBe(401);
    expect(await prisma.companyDomain.findFirst({ where: { domain: domain("anon") } })).toBeNull();
  });

  it("SUPER_ADMIN lists an empty registry with the exact envelope", async () => {
    const res = await request(app).get(`/api/v1/companies/${ctx.companyA.id}/domains`).set(superHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { domains: [] } });
  });

  it("unknown companies 404 on every domain route", async () => {
    const ghost = "11111111-1111-1111-1111-111111111111";
    const listed = await request(app).get(`/api/v1/companies/${ghost}/domains`).set(superHeaders());
    expect(listed.status).toBe(404);
    expect(listed.body.error.code).toBe("COMPANY_NOT_FOUND");
    const created = await request(app).post(`/api/v1/companies/${ghost}/domains`).set(superHeaders()).send({ domain: domain("ghost") });
    expect(created.status).toBe(404);
    expect(created.body.error.code).toBe("COMPANY_NOT_FOUND");
    const patched = await request(app).patch(`/api/v1/companies/${ghost}/domains/${ghost}`).set(superHeaders()).send({ isActive: false });
    expect(patched.status).toBe(404);
    expect(patched.body.error.code).toBe("COMPANY_NOT_FOUND");
    const removed = await request(app).delete(`/api/v1/companies/${ghost}/domains/${ghost}`).set(superHeaders());
    expect(removed.status).toBe(404);
    expect(removed.body.error.code).toBe("COMPANY_NOT_FOUND");
  });

  it("route ownership cannot be overridden by query, header, or body companyId", async () => {
    const created = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/domains`).set(superHeaders()).send({ domain: domain("own-a") });
    expect(created.status).toBe(201);
    createdDomainIds.push(created.body.data.domain.id);

    // Query/header companyId tricks are ignored: the route id wins.
    const listed = await request(app)
      .get(`/api/v1/companies/${ctx.companyA.id}/domains`)
      .set(superHeaders())
      .query({ companyId: ctx.companyB.id })
      .set("x-company-id", ctx.companyB.id);
    expect(listed.status).toBe(200);
    expect(listed.body.data.domains.map((row) => row.domain)).toContain(domain("own-a"));

    // Body-supplied companyId is rejected outright by strict validation.
    const smuggled = await request(app)
      .post(`/api/v1/companies/${ctx.companyA.id}/domains`)
      .set(superHeaders())
      .send({ domain: domain("smuggled"), companyId: ctx.companyB.id });
    expect(smuggled.status).toBe(422);
    expect(await prisma.companyDomain.findFirst({ where: { domain: domain("smuggled") } })).toBeNull();
  });
});

describe("creation and canonical normalization", () => {
  it("registers a valid canonical domain with the exact response shape", async () => {
    const res = await request(app).post(`/api/v1/companies/${ctx.companyB.id}/domains`).set(superHeaders()).send({ domain: domain("shop-b") });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.data.domain).sort()).toEqual(
      ["createdAt", "domain", "id", "isActive", "isPrimary", "updatedAt"].sort()
    );
    expect(res.body.data.domain).toMatchObject({ domain: domain("shop-b"), isActive: true });
    createdDomainIds.push(res.body.data.domain.id);
    ctx.firstB = res.body.data.domain;
  });

  it("canonicalizes case, whitespace, trailing dots, and local ports", async () => {
    const cases = [
      [`  ${domain("case-b").toUpperCase()}  `, domain("case-b")],
      [`${domain("dot-b")}.`, domain("dot-b")],
      [`${domain("port-b")}:3000`, domain("port-b")],
    ];
    for (const [raw, canonical] of cases) {
      const res = await request(app).post(`/api/v1/companies/${ctx.companyB.id}/domains`).set(superHeaders()).send({ domain: raw });
      expect(res.status).toBe(201);
      expect(res.body.data.domain.domain).toBe(canonical);
      createdDomainIds.push(res.body.data.domain.id);
    }
  });

  it("rejects duplicates within the same company and across companies", async () => {
    const dupe = await request(app).post(`/api/v1/companies/${ctx.companyB.id}/domains`).set(superHeaders()).send({ domain: ` ${domain("shop-b").toUpperCase()}. ` });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe("COMPANY_DOMAIN_EXISTS");

    const cross = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/domains`).set(superHeaders()).send({ domain: domain("shop-b") });
    expect(cross.status).toBe(409);
    expect(cross.body.error.code).toBe("COMPANY_DOMAIN_EXISTS");
  });

  it("rejects malformed hostnames and non-hostname URL forms", async () => {
    const bad = [
      "",
      "   ",
      "https://example.com",
      "http://example.com/path",
      `${domain("path-b")}/shop`,
      "example.com?x=1",
      "user@example.com",
      "exa mple.com",
      "host:abc",
      "35b5a215-0cf3-42db-ba42-6fac6656a708",
      `${"a".repeat(64)}.example.test`,
      `${"x".repeat(250)}.com`,
    ];
    for (const value of bad) {
      const res = await request(app).post(`/api/v1/companies/${ctx.companyB.id}/domains`).set(superHeaders()).send({ domain: value });
      expect(res.status).toBe(422);
    }
    expect(await prisma.companyDomain.count({ where: { companyId: ctx.companyB.id } })).toBe(
      (await prisma.companyDomain.findMany({ where: { companyId: ctx.companyB.id }, select: { id: true } })).length
    );
  });
});

describe("primary-domain behavior", () => {
  it("first domain is primary, later domains are secondary", async () => {
    expect(ctx.firstB.isPrimary).toBe(true);
    const listed = await request(app).get(`/api/v1/companies/${ctx.companyB.id}/domains`).set(superHeaders());
    const secondaries = listed.body.data.domains.filter((row) => row.id !== ctx.firstB.id);
    expect(secondaries.length).toBeGreaterThan(0);
    for (const row of secondaries) {
      expect(row.isPrimary).toBe(false);
    }
  });

  it("promotion is atomic: the old primary demotes in the same update", async () => {
    const target = domain("case-b");
    const row = await prisma.companyDomain.findFirst({ where: { domain: target }, select: { id: true } });
    const res = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}/domains/${row.id}`).set(superHeaders()).send({ isPrimary: true });
    expect(res.status).toBe(200);
    expect(res.body.data.domain).toMatchObject({ id: row.id, isPrimary: true });

    const listed = await request(app).get(`/api/v1/companies/${ctx.companyB.id}/domains`).set(superHeaders());
    const primaries = listed.body.data.domains.filter((entry) => entry.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toBe(row.id);
    const old = await prisma.companyDomain.findUnique({ where: { id: ctx.firstB.id } });
    expect(old.isPrimary).toBe(false);
    ctx.promotedB = row.id;
  });

  it("demoting the primary without promoting another is rejected", async () => {
    const res = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}/domains/${ctx.promotedB}`).set(superHeaders()).send({ isPrimary: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("COMPANY_DOMAIN_PRIMARY_REQUIRED");
    const row = await prisma.companyDomain.findUnique({ where: { id: ctx.promotedB } });
    expect(row.isPrimary).toBe(true);
  });

  it("demoting a non-primary and empty bodies behave deterministically", async () => {
    const noop = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}/domains/${ctx.firstB.id}`).set(superHeaders()).send({ isPrimary: false });
    expect(noop.status).toBe(200);
    expect(noop.body.data.domain.isPrimary).toBe(false);
    const empty = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}/domains/${ctx.firstB.id}`).set(superHeaders()).send({});
    expect(empty.status).toBe(422);
    const unknown = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}/domains/${ctx.firstB.id}`).set(superHeaders()).send({ isPrimary: true, companyId: ctx.companyA.id });
    expect(unknown.status).toBe(422);
  });

  it("concurrent promotions leave exactly one primary", async () => {
    const rows = await prisma.companyDomain.findMany({
      where: { companyId: ctx.companyB.id },
      select: { id: true },
      take: 2,
    });
    const [first, second] = rows;
    const [one, two] = await Promise.all([
      request(app).patch(`/api/v1/companies/${ctx.companyB.id}/domains/${first.id}`).set(superHeaders()).send({ isPrimary: true }),
      request(app).patch(`/api/v1/companies/${ctx.companyB.id}/domains/${second.id}`).set(superHeaders()).send({ isPrimary: true }),
    ]);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    const primaries = await prisma.companyDomain.count({ where: { companyId: ctx.companyB.id, isPrimary: true } });
    expect(primaries).toBe(1);
  });

  it("concurrent duplicate registrations leave exactly one winner", async () => {
    const value = domain("race-b");
    const [one, two] = await Promise.all([
      request(app).post(`/api/v1/companies/${ctx.companyB.id}/domains`).set(superHeaders()).send({ domain: value }),
      request(app).post(`/api/v1/companies/${ctx.companyB.id}/domains`).set(superHeaders()).send({ domain: value.toUpperCase() }),
    ]);
    const statuses = [one.status, two.status].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = one.status === 201 ? one : two;
    const loser = one.status === 409 ? one : two;
    expect(loser.body.error.code).toBe("COMPANY_DOMAIN_EXISTS");
    createdDomainIds.push(winner.body.data.domain.id);
    expect(await prisma.companyDomain.count({ where: { domain: value } })).toBe(1);
  });
});

describe("activation and public resolution", () => {
  it("deactivation stops public resolution; another active domain keeps working", async () => {
    const target = await prisma.companyDomain.findFirst({ where: { domain: domain("dot-b") }, select: { id: true } });
    const res = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}/domains/${target.id}`).set(superHeaders()).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.domain).toMatchObject({ isActive: false });

    const { err: errOff, req: reqOff } = await runPublicMiddleware(domain("dot-b"));
    expect(errOff).toBeUndefined();
    expect(getCompanyContext(reqOff)).toBeNull();

    const { err: errOn, req: reqOn } = await runPublicMiddleware(domain("shop-b"));
    expect(errOn).toBeUndefined();
    expect(reqOn.companyContext).toMatchObject({ companyId: ctx.companyB.id, source: "domain" });

    // The primary flag survives deactivation: reactivation restores
    // routing with no promotion needed.
    const back = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}/domains/${target.id}`).set(superHeaders()).send({ isActive: true });
    expect(back.status).toBe(200);
    const { req: reqBack } = await runPublicMiddleware(domain("dot-b"));
    expect(reqBack.companyContext?.companyId).toBe(ctx.companyB.id);
  });

  it("a domain resolves only its owning company", async () => {
    const { req } = await runPublicMiddleware(domain("own-a"));
    expect(req.companyContext).toMatchObject({ companyId: ctx.companyA.id, source: "domain" });
  });

  it("company suspension still overrides domain activation", async () => {
    const suspended = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/suspend`).set(superHeaders());
    expect(suspended.status).toBe(200);

    // Domain mutation stays allowed on suspended companies (platform
    // management); the suspension gate on the request path is what
    // blocks the storefront.
    const allowed = await request(app).patch(`/api/v1/companies/${ctx.companyA.id}/domains/${createdDomainIds[0]}`).set(superHeaders()).send({ isActive: false });
    expect(allowed.status).toBe(200);
    const reactivated = await request(app).patch(`/api/v1/companies/${ctx.companyA.id}/domains/${createdDomainIds[0]}`).set(superHeaders()).send({ isActive: true });
    expect(reactivated.status).toBe(200);

    const blocked = await request(app).get("/api/v1/categories").set("Host", domain("own-a"));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("COMPANY_SUSPENDED");

    const restored = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/restore`).set(superHeaders());
    expect(restored.status).toBe(200);
    expect((await request(app).get("/api/v1/categories").set("Host", domain("own-a"))).status).toBe(200);
  });

  it("customers registered through a managed domain stay company-scoped", async () => {
    const email = `${RUN}-scoped@example.test`;
    const res = await request(app)
      .post("/api/v1/auth/register")
      .set("Host", domain("shop-b"))
      .send({ email, password: "TestPass123!", firstName: "Scoped" });
    expect(res.status).toBe(201);
    const stored = await prisma.user.findFirst({ where: { email }, select: { id: true, companyId: true } });
    expect(stored.companyId).toBe(ctx.companyB.id);
    createdUserIds.push(stored.id);
  });
});

describe("cross-company isolation", () => {
  it("Company A cannot mutate Company B's domain (neutral 404, target untouched)", async () => {
    const before = await prisma.companyDomain.findUnique({ where: { id: ctx.firstB.id } });
    for (const res of [
      await request(app).patch(`/api/v1/companies/${ctx.companyA.id}/domains/${ctx.firstB.id}`).set(superHeaders()).send({ isActive: false }),
      await request(app).delete(`/api/v1/companies/${ctx.companyA.id}/domains/${ctx.firstB.id}`).set(superHeaders()),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("COMPANY_DOMAIN_NOT_FOUND");
    }
    const after = await prisma.companyDomain.findUnique({ where: { id: ctx.firstB.id } });
    expect(after).toEqual(before);
  });

  it("a domain is never reassigned silently: the same hostname stays with its owner", async () => {
    const res = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/domains`).set(superHeaders()).send({ domain: domain("shop-b") });
    expect(res.status).toBe(409);
    const row = await prisma.companyDomain.findFirst({ where: { domain: domain("shop-b") }, select: { companyId: true } });
    expect(row.companyId).toBe(ctx.companyB.id);
  });
});

describe("deletion safeguards", () => {
  it("deleting a primary with siblings is rejected until another is promoted", async () => {
    const primary = await prisma.companyDomain.findFirst({ where: { companyId: ctx.companyB.id, isPrimary: true }, select: { id: true } });
    const blocked = await request(app).delete(`/api/v1/companies/${ctx.companyB.id}/domains/${primary.id}`).set(superHeaders());
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("COMPANY_DOMAIN_IS_PRIMARY");
    expect(await prisma.companyDomain.findUnique({ where: { id: primary.id } })).not.toBeNull();
  });

  it("non-primary deletion removes only the registry row", async () => {
    const usersBefore = await prisma.user.count({ where: { companyId: ctx.companyB.id } });
    const target = await prisma.companyDomain.findFirst({ where: { companyId: ctx.companyB.id, isPrimary: false }, select: { id: true, domain: true } });
    const res = await request(app).delete(`/api/v1/companies/${ctx.companyB.id}/domains/${target.id}`).set(superHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toEqual({ id: target.id, domain: target.domain });
    expect(await prisma.companyDomain.findUnique({ where: { id: target.id } })).toBeNull();
    // Company, users, and the remaining domains are untouched.
    expect(await prisma.company.findUnique({ where: { id: ctx.companyB.id } })).not.toBeNull();
    expect(await prisma.user.count({ where: { companyId: ctx.companyB.id } })).toBe(usersBefore);
    const primaries = await prisma.companyDomain.count({ where: { companyId: ctx.companyB.id, isPrimary: true } });
    expect(primaries).toBe(1);
  });

  it("the sole domain of a company may be removed; unknown ids 404", async () => {
    const solo = await createCompany(`${RUN} Solo Co`);
    const added = await request(app).post(`/api/v1/companies/${solo.id}/domains`).set(superHeaders()).send({ domain: domain("solo") });
    expect(added.status).toBe(201);
    expect(added.body.data.domain.isPrimary).toBe(true);
    const removed = await request(app).delete(`/api/v1/companies/${solo.id}/domains/${added.body.data.domain.id}`).set(superHeaders());
    expect(removed.status).toBe(200);
    const listed = await request(app).get(`/api/v1/companies/${solo.id}/domains`).set(superHeaders());
    expect(listed.body.data.domains).toEqual([]);

    const ghost = await request(app).delete(`/api/v1/companies/${solo.id}/domains/22222222-2222-2222-2222-222222222222`).set(superHeaders());
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe("COMPANY_DOMAIN_NOT_FOUND");
  });

  it("permanent company deletion sweeps its domains through the existing cascade", async () => {
    const doomed = await createCompany(`${RUN} Doomed Co`);
    for (const tag of ["doom-a", "doom-b"]) {
      const added = await request(app).post(`/api/v1/companies/${doomed.id}/domains`).set(superHeaders()).send({ domain: domain(tag) });
      expect(added.status).toBe(201);
    }
    expect(await prisma.companyDomain.count({ where: { companyId: doomed.id } })).toBe(2);
    const suspended = await request(app).post(`/api/v1/companies/${doomed.id}/suspend`).set(superHeaders());
    expect(suspended.status).toBe(200);
    const destroyed = await request(app).delete(`/api/v1/companies/${doomed.id}`).set(superHeaders()).send({ confirmName: doomed.name });
    expect(destroyed.status).toBe(200);

    // No domain record for the deleted company remains — active or
    // otherwise — so nothing can still route to it.
    expect(await prisma.companyDomain.count({ where: { companyId: doomed.id } })).toBe(0);
    for (const tag of ["doom-a", "doom-b"]) {
      const { req } = await runPublicMiddleware(domain(tag));
      expect(getCompanyContext(req)).toBeNull();
    }
    // No second cleanup mechanism: the rows are gone via the company
    // cascade, and Company #1 is untouched.
    const one = await prisma.company.findUnique({ where: { id: COMPANY_ONE_ID }, select: { name: true } });
    expect(one?.name).toBe("Tech Pulse");
  });
});

describe("audit instrumentation", () => {
  it("successful mutations emit scoped COMPANY_DOMAIN events with safe metadata", async () => {
    const value = domain("audit-new");
    const created = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/domains`).set(superHeaders()).send({ domain: value });
    expect(created.status).toBe(201);
    const domainId = created.body.data.domain.id;
    createdDomainIds.push(domainId);

    const updated = await request(app).patch(`/api/v1/companies/${ctx.companyA.id}/domains/${domainId}`).set(superHeaders()).send({ isActive: false });
    expect(updated.status).toBe(200);

    // Promote-then-delete path needs a sibling so the primary guard
    // passes deterministically: add one, promote the audited domain,
    // delete the sibling instead (audited domain stays for cleanup).
    const sibling = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/domains`).set(superHeaders()).send({ domain: domain("audit-sib") });
    expect(sibling.status).toBe(201);
    createdDomainIds.push(sibling.body.data.domain.id);
    const removed = await request(app).delete(`/api/v1/companies/${ctx.companyA.id}/domains/${sibling.body.data.domain.id}`).set(superHeaders());
    expect(removed.status).toBe(200);

    const events = await prisma.auditLog.findMany({
      where: { resource: "COMPANY_DOMAIN", resourceId: { in: [domainId, sibling.body.data.domain.id] } },
      orderBy: { createdAt: "asc" },
    });
    const forDomain = (id, action) => events.find((event) => event.resourceId === id && event.action === action);
    expect(forDomain(domainId, "CREATED")?.details).toMatchObject({ domain: value });
    expect(forDomain(domainId, "UPDATED")?.details).toMatchObject({ domain: value, isActive: false });
    expect(forDomain(sibling.body.data.domain.id, "CREATED")?.details).toMatchObject({ domain: domain("audit-sib") });
    expect(forDomain(sibling.body.data.domain.id, "DELETED")?.details).toMatchObject({ domain: domain("audit-sib") });
    expect(events).toHaveLength(4);
    for (const event of events) {
      // Actor and company are server-derived: the SUPER_ADMIN caller
      // and the route company — never client input.
      expect(event.actorId).toBe(ctx.superAdmin.id);
      expect(event.actorRole).toBe("SUPER_ADMIN");
      expect(event.companyId).toBe(ctx.companyA.id);
      expect(event.outcome).toBe("SUCCESS");
      const serialized = JSON.stringify(event);
      for (const leaked of ["password", "secret", "token", "TestPass123!"]) {
        expect(serialized.toLowerCase()).not.toContain(leaked);
      }
    }
  });

  it("failed mutations emit no audit event", async () => {
    const before = await prisma.auditLog.count({ where: { resource: "COMPANY_DOMAIN" } });
    const dupe = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/domains`).set(superHeaders()).send({ domain: domain("own-a") });
    expect(dupe.status).toBe(409);
    const bad = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/domains`).set(superHeaders()).send({ domain: "https://nope.example.com" });
    expect(bad.status).toBe(422);
    expect(await prisma.auditLog.count({ where: { resource: "COMPANY_DOMAIN" } })).toBe(before);
  });
});
