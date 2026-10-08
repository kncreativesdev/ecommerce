import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";

/**
 * Tenant-isolation regression: authenticated admin operational catalog
 * reads use the identity company, never the Host header.
 *
 * Company A: ACTIVE + domain + category/product data.
 * Company B: ACTIVE + NO domain + no ecommerce data initially.
 *
 * Public storefront reads stay Host-based by design (unknown host fails
 * closed); the `/admin` catalog/image reads below must always serve the
 * caller's own company even when Host points at the other company.
 */

const RUN = `TSTADM${Date.now().toString(36).toUpperCase()}`;
const HOST_A = `${RUN.toLowerCase()}-a.example.test`;
const UNKNOWN_HOST = `${RUN.toLowerCase()}-unknown.example.test`;

const ctx = {};
const createdCompanyIds = [];
const createdUserIds = [];
const createdDomainIds = [];

const headersFor = (id, roles = ["ADMIN"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createCompany(tag, withDomain) {
  const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status: "ACTIVE" } });
  createdCompanyIds.push(company.id);
  const admin = await provisionCompanyAdmin(company.id, {
    email: `${RUN.toLowerCase()}-admin-${tag}@example.test`,
    password: "TestPass123!",
    firstName: "Iso",
    lastName: `Admin${tag.toUpperCase()}`,
  });
  createdUserIds.push(admin.id);
  let domain = null;
  if (withDomain) {
    domain = await prisma.companyDomain.create({
      data: { companyId: company.id, domain: HOST_A, isPrimary: true, isActive: true },
    });
    createdDomainIds.push(domain.id);
  }
  return { company, admin };
}

async function createStaff(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN.toLowerCase()}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Iso",
      lastName: tag,
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

beforeAll(async () => {
  const a = await createCompany("a", true);
  ctx.companyA = a.company;
  ctx.adminA = a.admin;
  const b = await createCompany("b", false);
  ctx.companyB = b.company;
  ctx.adminB = b.admin;
  ctx.headB = await createStaff("head-b", "HEAD", ctx.companyB.id);
  ctx.memberB = await createStaff("member-b", "MEMBER", ctx.companyB.id);
  ctx.customerB = await createStaff("customer-b", "CUSTOMER", ctx.companyB.id);
  ctx.superAdmin = await createStaff("super", "SUPER_ADMIN", null);

  const catRes = await request(app)
    .post("/api/v1/categories")
    .set(headersFor(ctx.adminA.id))
    .send({ name: `${RUN} Category A` });
  expect(catRes.status).toBe(201);
  ctx.catA = catRes.body.data.category;

  const prodRes = await request(app)
    .post("/api/v1/products")
    .set(headersFor(ctx.adminA.id))
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
  if (createdDomainIds.length > 0) {
    await prisma.companyDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
  }
  await prisma.auditLog.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  if (createdUserIds.length > 0) {
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
    await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.wishlistItem.deleteMany({ where: { wishlist: { userId: { in: createdUserIds } } } });
    await prisma.wishlist.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  await prisma.$disconnect();
});

const adminB = () => headersFor(ctx.adminB.id);

describe("admin operational catalog reads use identity company, never Host", () => {
  it("ADMIN B sees only B data via /categories/admin even when Host points at A", async () => {
    const res = await request(app).get("/api/v1/categories/admin").set({ ...adminB(), Host: HOST_A });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((c) => c.id);
    expect(ids).not.toContain(ctx.catA.id);
  });

  it("ADMIN B cannot read A's category via /categories/admin/:id", async () => {
    const res = await request(app).get(`/api/v1/categories/admin/${ctx.catA.id}`).set({ ...adminB(), Host: HOST_A });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CATEGORY_NOT_FOUND");
    expect(JSON.stringify(res.body)).not.toContain(ctx.catA.name);
  });

  it("ADMIN B sees only B data via /products/admin even when Host points at A", async () => {
    const res = await request(app).get("/api/v1/products/admin").set({ ...adminB(), Host: HOST_A });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((p) => p.id);
    expect(ids).not.toContain(ctx.productA.id);
  });

  it("ADMIN B cannot read A's product via /products/admin/:id (no field leakage)", async () => {
    const res = await request(app).get(`/api/v1/products/admin/${ctx.productA.id}`).set({ ...adminB(), Host: HOST_A });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
    expect(JSON.stringify(res.body)).not.toContain(ctx.productA.name);
  });

  it("ADMIN B cannot read A's images via /products/:id/images/admin", async () => {
    const res = await request(app).get(`/api/v1/products/${ctx.productA.id}/images/admin`).set({ ...adminB(), Host: HOST_A });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("ADMIN B admin reads work with an unknown Host (identity, not domain)", async () => {
    const cats = await request(app).get("/api/v1/categories/admin").set({ ...adminB(), Host: UNKNOWN_HOST });
    expect(cats.status).toBe(200);
    const prods = await request(app).get("/api/v1/products/admin").set({ ...adminB(), Host: UNKNOWN_HOST });
    expect(prods.status).toBe(200);
  });

  it("public storefront reads stay Host-based and fail closed on unknown hosts", async () => {
    const hostA = await request(app).get("/api/v1/categories").set("Host", HOST_A);
    expect(hostA.status).toBe(200);
    expect(hostA.body.data.map((c) => c.id)).toContain(ctx.catA.id);
    const unknown = await request(app).get("/api/v1/categories").set("Host", UNKNOWN_HOST);
    expect(unknown.status).toBe(404);
  });

  it("admin catalog reads reject anonymous/CUSTOMER/SUPER_ADMIN", async () => {
    const anon = await request(app).get("/api/v1/categories/admin");
    expect(anon.status).toBe(401);
    const customer = await request(app).get("/api/v1/categories/admin").set(headersFor(ctx.customerB.id, ["CUSTOMER"]));
    expect(customer.status).toBe(403);
    const platform = await request(app).get("/api/v1/products/admin").set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(platform.status).toBe(403);
  });

  it("inactive/all scopes stay ADMIN-only on admin reads (HEAD/MEMBER 403)", async () => {
    const headAll = await request(app).get("/api/v1/categories/admin").query({ status: "all" }).set(headersFor(ctx.headB.id, ["HEAD"]));
    expect(headAll.status).toBe(403);
    const memberInactive = await request(app).get("/api/v1/products/admin").query({ status: "inactive" }).set(headersFor(ctx.memberB.id, ["MEMBER"]));
    expect(memberInactive.status).toBe(403);
    const adminAll = await request(app).get("/api/v1/categories/admin").query({ status: "all" }).set(adminB());
    expect(adminAll.status).toBe(200);
  });

  it("HEAD/MEMBER active-scope admin reads are allowed and scoped", async () => {
    const head = await request(app).get("/api/v1/categories/admin").set(headersFor(ctx.headB.id, ["HEAD"]));
    expect(head.status).toBe(200);
    const member = await request(app).get("/api/v1/products/admin").set(headersFor(ctx.memberB.id, ["MEMBER"]));
    expect(member.status).toBe(200);
  });
});

describe("wishlist read gate fails closed on contaminated lines", () => {
  it("a foreign product line makes GET /wishlist fail closed instead of leaking", async () => {
    // Arrange: B customer with a directly-written cross-company line
    // (bypasses the guarded add path, like legacy contamination).
    const wishlist = await prisma.wishlist.upsert({
      where: { userId: ctx.customerB.id },
      create: { userId: ctx.customerB.id },
      update: {},
      select: { id: true },
    });
    const foreign = await prisma.wishlistItem.create({ data: { wishlistId: wishlist.id, productId: ctx.productA.id } });
    try {
      const res = await request(app).get("/api/v1/wishlist").set(headersFor(ctx.customerB.id, ["CUSTOMER"]));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
      expect(JSON.stringify(res.body)).not.toContain(ctx.productA.name);
    } finally {
      await prisma.wishlistItem.deleteMany({ where: { id: foreign.id } });
    }
    const clean = await request(app).get("/api/v1/wishlist").set(headersFor(ctx.customerB.id, ["CUSTOMER"]));
    expect(clean.status).toBe(200);
  });
});
