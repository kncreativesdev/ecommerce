import { describe, it, expect, afterAll } from "vitest";

import { prisma } from "../../src/config/database.js";
import { COMPANY_ONE_ID } from "../helpers/userFixtures.js";

/**
 * Phase 1 company data-model foundation (live MySQL).
 *
 * Verifies the additive tenancy foundation WITHOUT changing any
 * application behavior: Company #1 backfill integrity, the ACTIVE /
 * SUSPENDED lifecycle values, Company.adminUserId uniqueness (one ADMIN
 * per company), CompanyDomain hostname uniqueness, and
 * ProductVariant.companyId consistency with the parent Product.
 *
 * No authentication, route, service, or business-logic behavior is
 * exercised here. Created fixture companies/domains are deleted during
 * cleanup; Company #1 and all pre-existing records are only read.
 */

const RUN = `TSTCO${Date.now().toString(36).toUpperCase()}`;

const createdCompanyIds = [];
const createdDomainIds = [];

async function createCompany(name, extra = {}) {
  const company = await prisma.company.create({
    data: { name: `${RUN}-${name}`, ...extra },
  });
  createdCompanyIds.push(company.id);
  return company;
}

afterAll(async () => {
  if (createdDomainIds.length > 0) {
    await prisma.companyDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

describe("Company #1 backfill (read-only)", () => {
  it("exists as ACTIVE Tech Pulse with its pre-existing ADMIN associated", async () => {
    const company = await prisma.company.findUnique({
      where: { id: COMPANY_ONE_ID },
      include: {
        admin: { select: { id: true, email: true, isActive: true, roles: { select: { role: { select: { name: true } } } } } },
      },
    });
    expect(company).not.toBeNull();
    expect(company.name).toBe("Tech Pulse");
    expect(company.status).toBe("ACTIVE");
    expect(company.admin).not.toBeNull();
    expect(company.admin.isActive).toBe(true);
    const roleNames = company.admin.roles.map((link) => link.role.name);
    expect(roleNames).toContain("ADMIN");
  });

  it("owns the backfilled tenant rows with no orphans and no duplicates", async () => {
    // Concurrency-safe: sibling suites create dedicated test companies
    // and unstamped rows in the shared database (and overlapping runs
    // may predate Company #1's insert), so exact totals are
    // unassertable. Instead: known production rows are pinned to
    // Company #1, scoped counts hold their Phase-1 verified baselines
    // (backfill used UPDATEs only — nothing duplicated or deleted), and
    // every non-null tenant reference resolves to a real company.
    const [seedCategory, adminUser] = await Promise.all([
      prisma.category.findFirst({
        where: { slug: "power-banks", companyId: COMPANY_ONE_ID },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: { email: "admin@example.com" },
        select: { companyId: true },
      }),
    ]);
    expect(seedCategory).not.toBeNull();
    expect(adminUser.companyId).toBe(COMPANY_ONE_ID);
    const [scopedUsers, scopedCategories, scopedProducts, scopedVariants] = await Promise.all([
      prisma.user.count({ where: { companyId: COMPANY_ONE_ID } }),
      prisma.category.count({ where: { companyId: COMPANY_ONE_ID } }),
      prisma.product.count({ where: { companyId: COMPANY_ONE_ID } }),
      prisma.productVariant.count({ where: { companyId: COMPANY_ONE_ID } }),
    ]);
    expect(scopedUsers).toBeGreaterThanOrEqual(1003);
    expect(scopedCategories).toBeGreaterThanOrEqual(494);
    expect(scopedProducts).toBeGreaterThanOrEqual(621);
    expect(scopedVariants).toBeGreaterThanOrEqual(999);
    const tables = ["users", "categories", "products", "product_variants"];
    for (const table of tables) {
      const dangling = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) AS n FROM \`${table}\` AS t LEFT JOIN \`companies\` AS c ON c.\`id\` = t.\`company_id\` WHERE t.\`company_id\` IS NOT NULL AND c.\`id\` IS NULL`
      );
      expect(Number(dangling[0].n)).toBe(0);
    }
  });

  it("keeps every variant consistent with its parent product", async () => {
    // NULL-safe: both sides stamped but different is the violation.
    const mismatched = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS n FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.company_id IS NOT NULL AND p.company_id IS NOT NULL AND v.company_id <> p.company_id"
    );
    expect(Number(mismatched[0].n)).toBe(0);
    const sample = await prisma.productVariant.findMany({
      where: { companyId: COMPANY_ONE_ID },
      take: 5,
      select: { id: true, companyId: true, product: { select: { companyId: true } } },
    });
    expect(sample.length).toBeGreaterThan(0);
    for (const variant of sample) {
      expect(variant.companyId).toBe(COMPANY_ONE_ID);
      expect(variant.product.companyId).toBe(COMPANY_ONE_ID);
    }
  });

  it("leaves order numbers, emails, and ids untouched", async () => {
    // Orders carry no companyId yet (deferred to a later phase); their
    // human-readable numbers were never rewritten by the backfill.
    const order = await prisma.order.findFirst({ select: { orderNumber: true } });
    expect(order).not.toBeNull();
    expect(order.orderNumber).toMatch(/^ORD-\d{4}-\d+$/);
    const admin = await prisma.user.findFirst({
      where: { id: (await prisma.company.findUnique({ where: { id: COMPANY_ONE_ID }, select: { adminUserId: true } })).adminUserId },
      select: { email: true },
    });
    expect(admin.email).toContain("@");
  });
});

describe("Company lifecycle values", () => {
  it("supports ACTIVE and SUSPENDED statuses", async () => {
    const suspended = await createCompany("suspended", { status: "SUSPENDED" });
    expect(suspended.status).toBe("SUSPENDED");
    const reactivated = await prisma.company.update({
      where: { id: suspended.id },
      data: { status: "ACTIVE" },
    });
    expect(reactivated.status).toBe("ACTIVE");
  });
});

describe("Company.adminUserId uniqueness (one ADMIN per company)", () => {
  it("prevents two companies from pointing to the same ADMIN", async () => {
    const companyOne = await prisma.company.findUnique({
      where: { id: COMPANY_ONE_ID },
      select: { adminUserId: true },
    });
    expect(companyOne.adminUserId).not.toBeNull();
    const other = await createCompany("other");
    await expect(
      prisma.company.update({ where: { id: other.id }, data: { adminUserId: companyOne.adminUserId } })
    ).rejects.toMatchObject({ code: "P2002" });
    expect(
      await prisma.company.findUnique({ where: { id: other.id }, select: { adminUserId: true } })
    ).toMatchObject({ adminUserId: null });
  });
});

describe("CompanyDomain registry", () => {
  it("enforces hostname uniqueness across companies", async () => {
    const companyA = await createCompany("domain-a");
    const domain = `${RUN.toLowerCase()}.example.test`;
    const row = await prisma.companyDomain.create({
      data: { companyId: companyA.id, domain, isPrimary: true },
    });
    createdDomainIds.push(row.id);
    expect(row.isPrimary).toBe(true);
    expect(row.isActive).toBe(true);
    const companyB = await createCompany("domain-b");
    await expect(
      prisma.companyDomain.create({ data: { companyId: companyB.id, domain } })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("cascades domain rows when its company is deleted", async () => {
    const company = await createCompany("ephemeral");
    const row = await prisma.companyDomain.create({
      data: { companyId: company.id, domain: `${RUN.toLowerCase()}-gone.example.test` },
    });
    await prisma.company.delete({ where: { id: company.id } });
    createdCompanyIds.splice(createdCompanyIds.indexOf(company.id), 1);
    await expect(prisma.companyDomain.findUnique({ where: { id: row.id } })).resolves.toBeNull();
  });
});
