import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken, signRefreshToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin, provisionEmployee } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-13 suspension enforcement (live HTTP + MySQL).
 *
 * Dedicated ACTIVE (A) and SUSPENDED (S) companies with provisioned
 * ADMIN/HEAD/MEMBER/CUSTOMER each, plus a platform SUPER_ADMIN and
 * registered domains for both companies. Proves the centralized
 * `requireActiveCompany` boundary plus the login/refresh/register
 * session gates: suspended companies cannot operate, cannot renew
 * sessions, and cannot enroll new customers — while ACTIVE,
 * platform, anonymous, and unknown-host behavior is unchanged.
 *
 * Suspension deletes and mutates nothing (asserted at the end).
 * Cleanup: cart lines removed, catalog deactivated, domains and
 * order-free users removed; companies persist as ordinary rows.
 */

const RUN = `TSTSP${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const HOST_A = `${RUN}-a.example.test`;
const HOST_S = `${RUN}-s.example.test`;
const HOST_UNKNOWN = `${RUN}-nope.example.test`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];
const createdDomainIds = [];

const headersFor = (id, roles = ["CUSTOMER"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createUser(tag, roleName, companyId, password = "TestPass123!") {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword(password),
      firstName: "SuspIso",
      lastName: tag,
      phone: "9999999999",
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
  for (const [tag, status, host] of [["a", "ACTIVE", HOST_A], ["s", "SUSPENDED", HOST_S]]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "SuspIso",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = admin;
    for (const [role, key] of [["HEAD", `head${tag.toUpperCase()}`], ["MEMBER", `member${tag.toUpperCase()}`]]) {
      const employee = await provisionEmployee(
        { id: admin.id, companyId: company.id, roles: ["ADMIN"] },
        { email: `${RUN}-${key.toLowerCase()}@example.test`, password: "TestPass123!", firstName: "SuspIso", lastName: key, role }
      );
      createdUserIds.push(employee.id);
      ctx[key] = await prisma.user.findUnique({ where: { id: employee.id } });
    }
    const domain = await prisma.companyDomain.create({
      data: { companyId: company.id, domain: host, isPrimary: true, isActive: true },
    });
    createdDomainIds.push(domain.id);
  }
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.customerS = await createUser("customer-s", "CUSTOMER", ctx.companyS.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);

  const category = await prisma.category.create({
    data: { name: `${RUN} Cat S`, slug: `${RUN}-cat-s`, companyId: ctx.companyS.id },
  });
  const product = await prisma.product.create({
    data: {
      name: `${RUN} Widget S`,
      slug: `${RUN}-prod-s`,
      categoryId: category.id,
      companyId: ctx.companyS.id,
      isActive: true,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `${RUN}-S`,
      name: "Base",
      price: "30.00",
      isActive: true,
      companyId: ctx.companyS.id,
    },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, quantity: 5, reservedQuantity: 0 } });
  ctx.catS = { category, product, variant };
}, 180000);

afterAll(async () => {
  await prisma.cartItem.deleteMany({
    where: { cart: { userId: { in: [ctx.customerA?.id, ctx.customerS?.id].filter(Boolean) } } },
  });
  if (ctx.catS) {
    await prisma.productVariant.updateMany({ where: { productId: ctx.catS.product.id }, data: { isActive: false } });
    await prisma.product.updateMany({ where: { id: ctx.catS.product.id }, data: { isActive: false } });
    await prisma.category.updateMany({ where: { id: ctx.catS.category.id }, data: { isActive: false } });
  }
  if (createdDomainIds.length > 0) {
    await prisma.companyDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe("authenticated company operations", () => {
  it("ACTIVE company requests succeed (control)", async () => {
    const me = await request(app).get("/api/v1/users/me").set(headersFor(ctx.customerA.id));
    expect(me.status).toBe(200);
    const list = await request(app).get("/api/v1/orders/admin").set(headersFor(ctx.adminA.id, ["ADMIN"]));
    expect(list.status).toBe(200);
  });

  it.each([
    ["ADMIN", () => ctx.adminS.id, ["ADMIN"], "/api/v1/orders/admin"],
    ["HEAD", () => ctx.headS.id, ["HEAD"], "/api/v1/users/me"],
    ["MEMBER", () => ctx.memberS.id, ["MEMBER"], "/api/v1/users/me"],
    ["CUSTOMER", () => ctx.customerS.id, ["CUSTOMER"], "/api/v1/users/me"],
  ])("SUSPENDED %s cannot operate (%s)", async (_role, idOf, roles, path) => {
    const res = await request(app).get(path).set(headersFor(idOf(), roles));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
  });

  it("suspended cart mutation is rejected before stock logic", async () => {
    const res = await request(app)
      .post("/api/v1/cart/items")
      .set(headersFor(ctx.customerS.id))
      .send({ variantId: ctx.catS.variant.id, quantity: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
  });

  it("hostname and client companyId tricks cannot bypass suspension", async () => {
    const hostMix = await request(app)
      .get("/api/v1/users/me")
      .set("Host", HOST_A)
      .set(headersFor(ctx.customerS.id));
    expect(hostMix.status).toBe(403);
    expect(hostMix.body.error.code).toBe("COMPANY_SUSPENDED");
    const queryMix = await request(app)
      .get("/api/v1/users/me")
      .query({ companyId: ctx.companyA.id })
      .set({ ...headersFor(ctx.customerS.id), "x-company-id": ctx.companyA.id });
    expect(queryMix.status).toBe(403);
    // The suspension guard runs before validation, so even a
    // schema-valid body cannot reach the controller while suspended.
    const bodyMix = await request(app)
      .patch("/api/v1/users/me")
      .set(headersFor(ctx.customerS.id))
      .send({ firstName: "Bypass", companyId: ctx.companyA.id });
    expect(bodyMix.status).toBe(403);
    expect(bodyMix.body.error.code).toBe("COMPANY_SUSPENDED");
  });
});

describe("public suspended storefront", () => {
  it("suspended domain reads are rejected; active domain reads work", async () => {
    for (const path of [
      "/api/v1/categories",
      "/api/v1/products",
      `/api/v1/products/${ctx.catS.product.id}`,
      `/api/v1/reviews/product/${ctx.catS.product.id}`,
      "/api/v1/announcements/current",
      `/api/v1/products/${ctx.catS.product.id}/images`,
    ]) {
      const blocked = await request(app).get(path).set("Host", HOST_S);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe("COMPANY_SUSPENDED");
    }
    const open = await request(app).get("/api/v1/categories").set("Host", HOST_A);
    expect(open.status).toBe(200);
  });

  it("unknown hosts still fail closed as not-found (no suspension oracle)", async () => {
    const res = await request(app).get("/api/v1/products").set("Host", HOST_UNKNOWN);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });
});

describe("session and enrollment gates", () => {
  it("suspended login is rejected; ACTIVE and SUPER_ADMIN logins work", async () => {
    const blocked = await request(app).post("/api/v1/auth/login").send({
      email: `${RUN}-customer-s@example.test`,
      password: "TestPass123!",
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("COMPANY_SUSPENDED");
    const active = await request(app).post("/api/v1/auth/login").send({
      email: `${RUN}-customer-a@example.test`,
      password: "TestPass123!",
    });
    expect(active.status).toBe(200);
    const platform = await request(app).post("/api/v1/auth/login").send({
      email: `${RUN}-super@example.test`,
      password: "TestPass123!",
    });
    expect(platform.status).toBe(200);
  });

  it("suspended sessionless tokens keep legacy gating; ACTIVE refresh is unchanged", async () => {
    // Legacy order preserved: account/company gating precedes the
    // session lookup, so a server-signed token for a suspended user
    // still answers 403 (a sessionless token for anyone else 401s —
    // covered by the rotation suite).
    const blocked = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${signRefreshToken(ctx.customerS.id)}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("COMPANY_SUSPENDED");
    const activeLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: `${RUN}-customer-a@example.test`, password: "TestPass123!" });
    expect(activeLogin.status).toBe(200);
    const jar = (activeLogin.headers["set-cookie"] || []).find((c) => c.startsWith("refresh_token=")).split(";")[0];
    const active = await request(app).post("/api/v1/auth/refresh").set("Cookie", jar);
    expect(active.status).toBe(200);
    expect(typeof active.body.data.accessToken).toBe("string");
  });

  it("registration on a suspended domain creates nothing", async () => {
    const email = `${RUN}-nosusp@example.test`;
    const res = await request(app).post("/api/v1/auth/register").set("Host", HOST_S).send({
      email,
      password: "TestPass123!",
      firstName: "Nope",
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
    expect(await prisma.user.findFirst({ where: { email } })).toBeNull();
  });

  it("anonymous logout is unaffected", async () => {
    const res = await request(app).post("/api/v1/auth/logout");
    expect(res.status).toBe(200);
  });
});

describe("platform preservation and data intactness", () => {
  it("SUPER_ADMIN platform operations are not blocked", async () => {
    // authorize() still governs: SUPER_ADMIN is refused company admin
    // routes for role reasons, never for suspension.
    const res = await request(app)
      .get("/api/v1/users")
      .set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("suspension deleted and mutated nothing", async () => {
    const company = await prisma.company.findUnique({ where: { id: ctx.companyS.id } });
    expect(company.status).toBe("SUSPENDED");
    expect(await prisma.user.count({ where: { companyId: ctx.companyS.id } })).toBeGreaterThan(0);
    expect(await prisma.product.count({ where: { companyId: ctx.companyS.id } })).toBeGreaterThan(0);
    expect(await prisma.productVariant.count({ where: { companyId: ctx.companyS.id } })).toBeGreaterThan(0);
    expect(await prisma.inventory.count({ where: { variant: { companyId: ctx.companyS.id } } })).toBeGreaterThan(0);
  });
});
