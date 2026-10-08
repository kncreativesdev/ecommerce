import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";

/**
 * SUPER_ADMIN platform metadata + aggregate-summary contracts
 * (live HTTP + MySQL).
 *
 * - `PATCH /companies/:id` renames only: strict validation, protected
 *   fields (status/adminUserId/domains/settings) unreachable here,
 *   same-name no-op without audit, genuine renames audited with safe
 *   metadata only.
 * - `GET /companies/summary` is aggregate-only: counts by status,
 *   summed platform totals, lean per-company rows (identity + primary
 *   domain + displayed counts) — never operational rows or secrets.
 *   Company A/B aggregates stay separated.
 * - Non-SUPER_ADMIN callers are rejected on both new endpoints;
 *   existing suspend/restore/delete/domain/admin behavior is unchanged.
 */

const RUN = `TSTPF${Date.now().toString(36).toUpperCase()}`.toLowerCase();

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Plat",
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

beforeAll(async () => {
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);
  const deniedCompany = await prisma.company.create({ data: { name: `${RUN}-denied-co` } });
  createdCompanyIds.push(deniedCompany.id);
  for (const [tag, role] of [["admin", "ADMIN"], ["head", "HEAD"], ["member", "MEMBER"], ["customer", "CUSTOMER"]]) {
    ctx[tag] = await createUser(`denied-${tag}`, role, deniedCompany.id);
  }
  await prisma.company.update({ where: { id: deniedCompany.id }, data: { adminUserId: ctx.admin.id } });
  ctx.deniedCompany = deniedCompany;

  // Company A with catalog + customer; Company B empty.
  for (const tag of ["a", "b"]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}` } });
    createdCompanyIds.push(company.id);
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "Plat",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    ctx[`admin${tag.toUpperCase()}`] = admin;
  }
  const catRes = await request(app)
    .post("/api/v1/categories")
    .set(headersFor(ctx.adminA.id, ["ADMIN"]))
    .send({ name: `${RUN} Category A` });
  expect(catRes.status).toBe(201);
  ctx.catA = catRes.body.data.category;
  const prodRes = await request(app)
    .post("/api/v1/products")
    .set(headersFor(ctx.adminA.id, ["ADMIN"]))
    .send({ name: `${RUN} Widget A`, categoryId: ctx.catA.id, variants: [{ sku: `${RUN}-A1`, name: "base", price: "99.00" }] });
  expect(prodRes.status).toBe(201);
  ctx.productA = prodRes.body.data.product;
}, 120000);

afterAll(async () => {
  const products = await prisma.product.findMany({ where: { companyId: { in: createdCompanyIds } }, select: { id: true } });
  for (const p of products) {
    await prisma.productVariant.deleteMany({ where: { productId: p.id } });
  }
  await prisma.product.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await prisma.category.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  if (createdCompanyIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { resourceId: { in: createdCompanyIds } },
          { resourceId: { in: createdUserIds } },
          { actorId: { in: createdUserIds } },
          { companyId: { in: createdCompanyIds } },
        ],
      },
    });
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

const superHeaders = () => headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
const adminHeaders = () => headersFor(ctx.admin.id, ["ADMIN"]);

describe("company metadata update (rename)", () => {
  it("SUPER_ADMIN renames a company and receives the safe detail shape", async () => {
    const res = await request(app)
      .patch(`/api/v1/companies/${ctx.companyB.id}`)
      .set(superHeaders())
      .send({ name: `${RUN}-co-b-renamed` });
    expect(res.status).toBe(200);
    expect(res.body.data.company.name).toBe(`${RUN}-co-b-renamed`);
    expect(res.body.data.company.id).toBe(ctx.companyB.id);
    expect(res.body.data.company.status).toBe("ACTIVE");
    const stored = await prisma.company.findUnique({ where: { id: ctx.companyB.id } });
    expect(stored.name).toBe(`${RUN}-co-b-renamed`);
  });

  it("rename does not alter status, ADMIN identity, domains, or settings", async () => {
    const before = await prisma.company.findUnique({ where: { id: ctx.companyB.id } });
    const res = await request(app)
      .patch(`/api/v1/companies/${ctx.companyB.id}`)
      .set(superHeaders())
      .send({ name: `${RUN}-co-b-renamed-2` });
    expect(res.status).toBe(200);
    const after = await prisma.company.findUnique({ where: { id: ctx.companyB.id } });
    expect(after.status).toBe(before.status);
    expect(after.adminUserId).toBe(before.adminUserId);
    expect(after.googleSignInEnabled).toBe(before.googleSignInEnabled);
    expect(res.body.data.company.status).toBe("ACTIVE");
  });

  it("protected fields are rejected by strict validation", async () => {
    for (const body of [
      { name: `${RUN}-x`, status: "SUSPENDED" },
      { name: `${RUN}-x`, companyId: ctx.companyA.id },
      { name: `${RUN}-x`, adminUserId: ctx.adminA.id },
      { status: "SUSPENDED" },
      {},
    ]) {
      const res = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}`).set(superHeaders()).send(body);
      expect(res.status).toBe(422);
    }
    const stored = await prisma.company.findUnique({ where: { id: ctx.companyB.id } });
    expect(stored.status).toBe("ACTIVE");
  });

  it("empty names are rejected and unknown companies 404", async () => {
    for (const body of [{ name: "" }, { name: "   " }]) {
      const res = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}`).set(superHeaders()).send(body);
      expect(res.status).toBe(422);
    }
    const missing = await request(app)
      .patch("/api/v1/companies/00000000-0000-0000-0000-000000000000")
      .set(superHeaders())
      .send({ name: `${RUN}-ghost` });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("COMPANY_NOT_FOUND");
  });

  it("same-name writes succeed without an audit event", async () => {
    const current = (await prisma.company.findUnique({ where: { id: ctx.companyB.id } })).name;
    const before = await prisma.auditLog.count({ where: { resource: "COMPANY", resourceId: ctx.companyB.id } });
    const res = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}`).set(superHeaders()).send({ name: current });
    expect(res.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { resource: "COMPANY", resourceId: ctx.companyB.id } })).toBe(before);
  });

  it("genuine renames are audited with safe metadata only", async () => {
    const previous = (await prisma.company.findUnique({ where: { id: ctx.companyB.id } })).name;
    const res = await request(app)
      .patch(`/api/v1/companies/${ctx.companyB.id}`)
      .set(superHeaders())
      .send({ name: `${RUN}-co-b-final` });
    expect(res.status).toBe(200);
    const events = await prisma.auditLog.findMany({
      where: { resource: "COMPANY", resourceId: ctx.companyB.id, action: "UPDATED" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(events.length).toBe(1);
    expect(events[0].companyId).toBe(ctx.companyB.id);
    expect(events[0].details).toEqual({ changedFields: ["name"], previousValues: { name: previous } });
    const serialized = JSON.stringify(events[0]).toLowerCase();
    for (const leaked of ["password", "hash", "token", "secret", "otp"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("non-SUPER_ADMIN and anonymous callers are rejected", async () => {
    const anon = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}`).send({ name: `${RUN}-nope` });
    expect(anon.status).toBe(401);
    for (const [tag, roles] of [["admin", ["ADMIN"]], ["head", ["HEAD"]], ["member", ["MEMBER"]], ["customer", ["CUSTOMER"]]]) {
      const res = await request(app)
        .patch(`/api/v1/companies/${ctx.companyB.id}`)
        .set(headersFor(ctx[tag].id, roles))
        .send({ name: `${RUN}-nope` });
      expect(res.status).toBe(403);
    }
  });
});

describe("platform aggregate summary", () => {
  it(
    "SUPER_ADMIN receives counts, totals, and per-company aggregates — never rows or secrets",
    { timeout: 60000 },
    async () => {
      const res = await request(app).get("/api/v1/companies/summary").set(superHeaders());
      expect(res.status).toBe(200);
      const { summary } = res.body.data;
      expect(summary.totalCompanies).toBeGreaterThanOrEqual(2);
      expect(summary.activeCompanies + summary.suspendedCompanies).toBe(summary.totalCompanies);
      for (const key of ["totalUsers", "totalCustomers", "totalHeads", "totalMembers", "totalProducts", "totalOrders"]) {
        expect(typeof summary.totals[key]).toBe("number");
      }
      const byId = new Map(summary.companies.map((c) => [c.id, c]));
      expect(byId.get(ctx.companyA.id).aggregates.totalProducts).toBe(1);
      expect(byId.get(ctx.companyB.id).aggregates.totalProducts).toBe(0);
      // Lean per-company rows: exactly the dashboard contract — no
      // profile columns, timestamps, domain arrays, or non-displayed
      // counts, so payload scales with company count alone.
      for (const row of summary.companies) {
        expect(Object.keys(row).sort()).toEqual(["aggregates", "id", "name", "primaryDomain", "status"].sort());
        expect(Object.keys(row.aggregates).sort()).toEqual(["totalOrders", "totalProducts", "totalUsers"].sort());
      }
      const serialized = JSON.stringify(res.body);
      for (const rowMarker of ['"products"', '"orders"', '"orderItems"', '"reviews"', '"password_hash"', '"passwordHash"']) {
        expect(serialized).not.toContain(rowMarker);
      }
      for (const leaked of ["password", "passwordHash", "refreshToken", "otp"]) {
        expect(serialized).not.toContain(leaked);
      }
      expect(serialized).not.toContain(ctx.productA.name);
      expect(serialized).not.toContain(ctx.catA.name);
    }
  );

  it(
    "statistics for Company A and Company B remain correctly separated",
    { timeout: 60000 },
    async () => {
      const res = await request(app).get("/api/v1/companies/summary").set(superHeaders());
      expect(res.status).toBe(200);
      const byId = new Map(res.body.data.summary.companies.map((c) => [c.id, c]));
      const a = byId.get(ctx.companyA.id);
      const b = byId.get(ctx.companyB.id);
      expect(a.status).toBe("ACTIVE");
      expect(b.status).toBe("ACTIVE");
      expect(a.aggregates.totalProducts).toBeGreaterThanOrEqual(1);
      expect(b.aggregates.totalProducts).toBe(0);
      expect(a.id).not.toBe(b.id);
    }
  );

  it(
    "primary domains resolve per company and domain-less companies report null",
    { timeout: 60000 },
    async () => {
      const domain = await prisma.companyDomain.create({
        data: { companyId: ctx.companyA.id, domain: `${RUN}-a.example.test`, isPrimary: true, isActive: true },
      });
      try {
        const res = await request(app).get("/api/v1/companies/summary").set(superHeaders());
        expect(res.status).toBe(200);
        const byId = new Map(res.body.data.summary.companies.map((c) => [c.id, c]));
        expect(byId.get(ctx.companyA.id).primaryDomain).toBe(`${RUN}-a.example.test`);
        // Company B holds no domain: null, never a sibling's domain.
        expect(byId.get(ctx.companyB.id).primaryDomain).toBeNull();
        // Empty company still reports zeroed (not missing) aggregates.
        expect(byId.get(ctx.companyB.id).aggregates).toEqual({
          totalUsers: 1,
          totalProducts: 0,
          totalOrders: 0,
        });
      } finally {
        await prisma.companyDomain.deleteMany({ where: { id: domain.id } });
      }
    }
  );

  it("non-SUPER_ADMIN and anonymous callers are rejected", async () => {
    const anon = await request(app).get("/api/v1/companies/summary");
    expect(anon.status).toBe(401);
    const admin = await request(app).get("/api/v1/companies/summary").set(adminHeaders());
    expect(admin.status).toBe(403);
    expect(admin.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("SUPER_ADMIN still cannot reach company operational row endpoints", async () => {
    const res = await request(app).post("/api/v1/products").set(superHeaders()).send({
      name: `${RUN} Super`,
      categoryId: ctx.catA.id,
    });
    expect(res.status).toBe(403);
  });
});

describe("existing lifecycle behavior is unchanged", () => {
  it("suspend/restore/delete guards still hold around the new endpoints", async () => {
    const suspend = await request(app).post(`/api/v1/companies/${ctx.companyB.id}/suspend`).set(superHeaders());
    expect(suspend.status).toBe(200);
    const renameWhileSuspended = await request(app)
      .patch(`/api/v1/companies/${ctx.companyB.id}`)
      .set(superHeaders())
      .send({ name: `${RUN}-co-b-suspended` });
    expect(renameWhileSuspended.status).toBe(200);
    const restore = await request(app).post(`/api/v1/companies/${ctx.companyB.id}/restore`).set(superHeaders());
    expect(restore.status).toBe(200);
    const wrongConfirm = await request(app)
      .delete(`/api/v1/companies/${ctx.companyB.id}`)
      .set(superHeaders())
      .send({ confirmName: "wrong name" });
    expect(wrongConfirm.status).toBe(409);
  });
});
