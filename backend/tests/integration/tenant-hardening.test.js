import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { execFileSync } from "child_process";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";
import { COMPANY_ONE_ID } from "../helpers/userFixtures.js";

/**
 * Phase 2C-10 tenant hardening (live HTTP + MySQL + DDL enforcement).
 *
 * Verifies the database now reflects the application guarantees:
 * company-owned rows require companyId (rejected at the database,
 * not just the service), business slugs/SKUs are unique per company
 * while manufacturer/global identifiers stay global, auth semantics
 * are untouched, and the seed stamps Company #1.
 *
 * Dedicated companies A/B; Company #1 read-only except the idempotent
 * seed run (canonical values). Cleanup deletes dedicated-company rows
 * (no orders reference them) and deactivates nothing else.
 */

const RUN = `TSTTH${Date.now().toString(36).toUpperCase()}`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles = ["ADMIN"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

beforeAll(async () => {
  for (const tag of ["a", "b"]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}` } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN.toLowerCase()}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "Hard",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = admin;
  }
}, 120000);

afterAll(async () => {
  await prisma.coupon.deleteMany({ where: { code: { startsWith: RUN } } });
  for (const tag of ["A", "B"]) {
    const company = ctx[`company${tag}`];
    if (!company) continue;
    // Dedicated companies hold only this file's rows (RUN slugs/codes)
    // with no orders referencing them: variants, then products, then
    // categories (FK order), then marketing/announcements.
    await prisma.productVariant.deleteMany({ where: { companyId: company.id } });
    await prisma.product.deleteMany({ where: { companyId: company.id } });
    await prisma.category.deleteMany({ where: { companyId: company.id } });
    await prisma.marketingNotification.deleteMany({ where: { companyId: company.id } });
    await prisma.siteAnnouncement.deleteMany({ where: { companyId: company.id } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

describe("companyId is required at the database boundary", () => {
  it("category creation without companyId is rejected", async () => {
    await expect(
      prisma.category.create({ data: { name: "NoCo", slug: `${RUN.toLowerCase()}-noco` } })
    ).rejects.toThrow();
    expect(
      await prisma.category.findFirst({ where: { slug: `${RUN.toLowerCase()}-noco` } })
    ).toBeNull();
  });

  it("product creation without companyId is rejected", async () => {
    const scratch = await prisma.category.create({
      data: { name: `${RUN} Scratch`, slug: `${RUN.toLowerCase()}-scratch`, companyId: ctx.companyA.id },
    });
    await expect(
      prisma.product.create({
        data: { name: "NoCo", slug: `${RUN.toLowerCase()}-noco-prod`, categoryId: scratch.id },
      })
    ).rejects.toThrow();
    await prisma.category.delete({ where: { id: scratch.id } });
  });

  it("variant creation without companyId is rejected", async () => {
    const scratchCat = await prisma.category.create({
      data: { name: `${RUN} Scratch2`, slug: `${RUN.toLowerCase()}-scratch2`, companyId: ctx.companyA.id },
    });
    const scratchProd = await prisma.product.create({
      data: {
        name: "NoCo",
        slug: `${RUN.toLowerCase()}-noco-prod2`,
        categoryId: scratchCat.id,
        companyId: ctx.companyA.id,
      },
    });
    await expect(
      prisma.productVariant.create({
        data: { productId: scratchProd.id, sku: `${RUN}-NOCO`, name: "NoCo", price: "1.00" },
      })
    ).rejects.toThrow();
    await prisma.product.delete({ where: { id: scratchProd.id } });
    await prisma.category.delete({ where: { id: scratchCat.id } });
  });

  it("coupon/marketing/announcement creation without companyId is rejected", async () => {
    await expect(
      prisma.coupon.create({ data: { code: `${RUN}-NOCO`, discountType: "FIXED", discountValue: "1.00" } })
    ).rejects.toThrow();
    await expect(
      prisma.marketingNotification.create({ data: { title: "NoCo", message: "x" } })
    ).rejects.toThrow();
    await expect(prisma.siteAnnouncement.create({ data: { message: "NoCo" } })).rejects.toThrow();
  });

  it("API-created catalog persists the creator's company", async () => {
    const cat = await request(app).post("/api/v1/categories").set(headersFor(ctx.adminA.id)).send({
      name: `${RUN} Cat A`,
    });
    expect(cat.status).toBe(201);
    ctx.catAId = cat.body.data.category.id;
    const stored = await prisma.category.findUnique({ where: { id: ctx.catAId } });
    expect(stored.companyId).toBe(ctx.companyA.id);
  });
});

describe("composite uniqueness is per-company", () => {
  it("same slug reused across companies is accepted", async () => {
    const slug = `${RUN.toLowerCase()}-shared`;
    for (const tag of ["A", "B"]) {
      const res = await request(app)
        .post("/api/v1/categories")
        .set(headersFor(ctx[`admin${tag}`].id))
        .send({ name: `${RUN} Shared ${tag}`, slug });
      expect(res.status).toBe(201);
      const stored = await prisma.category.findUnique({ where: { id: res.body.data.category.id } });
      expect(stored.companyId).toBe(ctx[`company${tag}`].id);
    }
  });

  it("duplicate slug within the same company is rejected", async () => {
    const res = await request(app).post("/api/v1/categories").set(headersFor(ctx.adminA.id)).send({
      name: `${RUN} Shared A`,
      slug: `${RUN.toLowerCase()}-shared`,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CATEGORY_SLUG_EXISTS");
  });

  it("same SKU reused across companies is accepted; duplicates within are rejected", async () => {
    const sku = `${RUN}-SHARED`;
    const catIds = {};
    for (const tag of ["A", "B"]) {
      const cat = await request(app).post("/api/v1/categories").set(headersFor(ctx[`admin${tag}`].id)).send({
        name: `${RUN} Sku Cat ${tag}`,
      });
      expect(cat.status).toBe(201);
      catIds[tag] = cat.body.data.category.id;
      const product = await request(app).post("/api/v1/products").set(headersFor(ctx[`admin${tag}`].id)).send({
        name: `${RUN} Prod ${tag}`,
        categoryId: catIds[tag],
        variants: [{ sku, name: "Base", price: "10.00" }],
      });
      expect(product.status).toBe(201);
    }
    const dup = await request(app).post("/api/v1/products").set(headersFor(ctx.adminA.id)).send({
      name: `${RUN} Prod Adup`,
      categoryId: catIds.A,
      variants: [{ sku, name: "Base", price: "10.00" }],
    });
    expect(dup.status).toBe(409);
    expect(["PRODUCT_SLUG_EXISTS", "PRODUCT_VARIANT_SKU_EXISTS"]).toContain(dup.body.error.code);
  });
});

describe("global identifiers stay global", () => {
  it("duplicate barcode across companies is rejected", async () => {
    const barcode = `${RUN}-BC-1`;
    const make = async (adminId, categoryId, sku) =>
      request(app).post("/api/v1/products").set(headersFor(adminId)).send({
        name: `${RUN} Bc`,
        categoryId,
        variants: [{ sku, name: "Base", price: "10.00", barcode }],
      });
    const catA = await request(app).post("/api/v1/categories").set(headersFor(ctx.adminA.id)).send({
      name: `${RUN} Bc Cat A`,
    });
    expect(catA.status).toBe(201);
    const catB = await request(app).post("/api/v1/categories").set(headersFor(ctx.adminB.id)).send({
      name: `${RUN} Bc Cat B`,
    });
    expect(catB.status).toBe(201);
    const first = await make(ctx.adminA.id, catA.body.data.category.id, `${RUN}-BC-A`);
    expect(first.status).toBe(201);
    const second = await make(ctx.adminB.id, catB.body.data.category.id, `${RUN}-BC-B`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("PRODUCT_VARIANT_BARCODE_EXISTS");
  });

  it("duplicate coupon code across companies is rejected", async () => {
    const code = `${RUN}-GLOBAL`;
    const first = await request(app).post("/api/v1/coupons").set(headersFor(ctx.adminA.id)).send({
      code,
      discountType: "FIXED",
      discountValue: "3.00",
    });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/v1/coupons").set(headersFor(ctx.adminB.id)).send({
      code,
      discountType: "FIXED",
      discountValue: "3.00",
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("COUPON_CODE_EXISTS");
  });

  it("duplicate email and domain stay globally rejected", async () => {
    const dupEmail = await request(app).post("/api/v1/auth/register").send({
      email: `${RUN.toLowerCase()}-admin-a@example.test`,
      password: "TestPass123!",
      firstName: "Dup",
    });
    expect(dupEmail.status).toBe(409);
    await prisma.companyDomain.deleteMany({ where: { domain: "dup-check-2c10.example.test" } });
    const row = await prisma.companyDomain.create({
      data: { companyId: ctx.companyA.id, domain: "dup-check-2c10.example.test" },
    });
    await expect(
      prisma.companyDomain.create({ data: { companyId: ctx.companyB.id, domain: "dup-check-2c10.example.test" } })
    ).rejects.toThrow();
    await prisma.companyDomain.delete({ where: { id: row.id } });
  });
});

describe("auth behavior unchanged; seed stamps Company #1", () => {
  it("local login still works with unchanged shape", async () => {
    const email = `${RUN.toLowerCase()}-login@example.test`;
    const registered = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "TestPass123!",
      firstName: "Login",
    });
    expect(registered.status).toBe(201);
    const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
    expect(loggedIn.status).toBe(200);
    expect(typeof loggedIn.body.data.accessToken).toBe("string");
    expect(loggedIn.body.data.user.email).toBe(email);
    expect(loggedIn.headers["set-cookie"].join(";")).toMatch(/httponly/i);
  });

  it("seed run leaves no companyless catalog and keeps Company #1 ownership", async () => {
    const { execFileSync } = await import("child_process");
    execFileSync("node", ["prisma/seed.js"], { cwd: process.cwd(), timeout: 180000, stdio: "pipe" });
    // Raw SQL: the Prisma client rejects null filters on the now-required
    // columns, so NULL-absence is asserted at the database level.
    for (const table of ["categories", "products", "product_variants"]) {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`company_id\` IS NULL`
      );
      expect(Number(rows[0].n)).toBe(0);
    }
    const seedCategory = await prisma.category.findFirst({
      where: { slug: "power-banks", companyId: COMPANY_ONE_ID },
      select: { id: true },
    });
    expect(seedCategory).not.toBeNull();
  }, 200000);
});
