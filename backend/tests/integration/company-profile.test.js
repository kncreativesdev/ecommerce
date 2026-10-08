import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-33 company business-profile contract (live HTTP + MySQL).
 *
 * Ten nullable profile columns (contactEmail/contactPhone/address ×6/
 * website/logoPath): PATCH accept/normalize/clear semantics, HTTPS-only
 * website gate, logoPath never client-settable, changedFields/
 * previousValues audit payload, no-op without audit, SUPER_ADMIN-only
 * access, suspended-company manageability, dedicated logo upload/
 * removal through the raster-only pipeline with company-prefixed
 * storage and deletion-cascade coverage. List/summary stay lean.
 */

const RUN = `TSTCP${Date.now().toString(36).toUpperCase()}`.toLowerCase();

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function pngBuffer() {
  return sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 20, g: 140, b: 60 } } })
    .png()
    .toBuffer();
}

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Prof",
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

  for (const tag of ["a", "b"]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}` } });
    createdCompanyIds.push(company.id);
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "Prof",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`company${tag.toUpperCase()}`] = company;
  }
  // Company A catalog for A/B aggregate separation checks.
  const cat = await prisma.category.create({
    data: { name: `${RUN} Cat A`, slug: `${RUN}-cat-a`, companyId: ctx.companyA.id },
  });
  const product = await prisma.product.create({
    data: { name: `${RUN} Widget A`, slug: `${RUN}-widget-a`, categoryId: cat.id, companyId: ctx.companyA.id },
  });
  await prisma.productVariant.create({
    data: { productId: product.id, sku: `${RUN}-A1`, name: "base", price: "99.00", companyId: ctx.companyA.id },
  });
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

const PROFILE_KEYS = [
  "contactEmail",
  "contactPhone",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  "website",
  "logoPath",
];

const FULL_PROFILE = {
  contactEmail: "HQ@Acme-Store.Test",
  contactPhone: "  +1-555-0100  ",
  addressLine1: "  1 Market Street  ",
  addressLine2: "",
  city: "Springfield",
  state: "IL",
  postalCode: "62701",
  country: "USA",
  website: "https://acme-store.test/shop",
};

describe("company detail exposes the approved profile shape", () => {
  it("migration adds exactly the ten approved nullable columns with no backfill", async () => {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable, COLUMN_TYPE AS columnType
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies'
        AND COLUMN_NAME IN
          ('contact_email','contact_phone','address_line1','address_line2',
           'city','state','postal_code','country','website','logo_path')
    `);
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row.nullable).toBe("YES");
    }
    const byName = new Map(rows.map((row) => [row.name, row.columnType.toLowerCase()]));
    expect(byName.get("contact_email")).toContain("varchar(255)");
    expect(byName.get("contact_phone")).toContain("varchar(30)");
    expect(byName.get("postal_code")).toContain("varchar(20)");
    expect(byName.get("website")).toContain("varchar(500)");
    expect(byName.get("logo_path")).toContain("varchar(500)");
    // No backfill: pre-existing Company #1 reads NULL across the profile.
    const companyOne = await prisma.company.findUnique({
      where: { id: "35b5a215-0cf3-42db-ba42-6fac6656a708" },
    });
    for (const key of [
      "contactEmail",
      "contactPhone",
      "addressLine1",
      "addressLine2",
      "city",
      "state",
      "postalCode",
      "country",
      "website",
      "logoPath",
    ]) {
      expect(companyOne[key]).toBeNull();
    }
  });

  it("GET detail returns all ten profile fields defaulting to NULL", async () => {
    const res = await request(app).get(`/api/v1/companies/${ctx.companyB.id}`).set(superHeaders());
    expect(res.status).toBe(200);
    for (const key of PROFILE_KEYS) {
      expect(res.body.data.company[key]).toBeNull();
    }
  });

  it("list and summary rows stay lean (no profile fields)", async () => {
    const list = await request(app).get("/api/v1/companies").set(superHeaders());
    expect(list.status).toBe(200);
    for (const company of list.body.data.companies) {
      for (const key of PROFILE_KEYS) {
        expect(company).not.toHaveProperty(key);
      }
    }
    const summary = await request(app).get("/api/v1/companies/summary").set(superHeaders());
    expect(summary.status).toBe(200);
    for (const company of summary.body.data.summary.companies) {
      for (const key of PROFILE_KEYS) {
        expect(company).not.toHaveProperty(key);
      }
    }
  });
});

describe("PATCH profile accept/normalize/clear semantics", () => {
  it("accepts a full valid profile and normalizes values", async () => {
    const res = await request(app)
      .patch(`/api/v1/companies/${ctx.companyB.id}`)
      .set(superHeaders())
      .send(FULL_PROFILE);
    expect(res.status).toBe(200);
    const company = res.body.data.company;
    expect(company.contactEmail).toBe("hq@acme-store.test");
    expect(company.contactPhone).toBe("+1-555-0100");
    expect(company.addressLine1).toBe("1 Market Street");
    expect(company.addressLine2).toBeNull();
    expect(company.city).toBe("Springfield");
    expect(company.website).toBe("https://acme-store.test/shop");
    const stored = await prisma.company.findUnique({ where: { id: ctx.companyB.id } });
    expect(stored.contactEmail).toBe("hq@acme-store.test");
    expect(stored.addressLine2).toBeNull();
  });

  it("trims/normalizes on read-back and clears fields on empty optionals", async () => {
    const res = await request(app)
      .patch(`/api/v1/companies/${ctx.companyB.id}`)
      .set(superHeaders())
      .send({ contactEmail: "   ", city: "", website: null, country: "USA" });
    expect(res.status).toBe(200);
    expect(res.body.data.company.contactEmail).toBeNull();
    expect(res.body.data.company.city).toBeNull();
    expect(res.body.data.company.website).toBeNull();
    expect(res.body.data.company.country).toBe("USA");
  });

  it("rejects invalid email addresses", async () => {
    for (const contactEmail of ["not-an-email", "a@b", "@example.test", "x".repeat(250) + "@example.test"]) {
      const res = await request(app)
        .patch(`/api/v1/companies/${ctx.companyB.id}`)
        .set(superHeaders())
        .send({ contactEmail });
      expect(res.status).toBe(422);
    }
  });

  it("rejects non-HTTPS, script-capable, and malformed websites", async () => {
    for (const website of [
      "http://acme-store.test",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "notaurl",
      "https://",
      "ftp://acme-store.test/files",
      "https://has space.test/x",
    ]) {
      const res = await request(app)
        .patch(`/api/v1/companies/${ctx.companyB.id}`)
        .set(superHeaders())
        .send({ website });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("COMPANY_INVALID_WEBSITE");
    }
    const stored = await prisma.company.findUnique({ where: { id: ctx.companyB.id } });
    expect(stored.website).toBeNull();
  });

  it("rejects over-length fields", async () => {
    const over = {
      contactPhone: "1".repeat(31),
      city: "c".repeat(101),
      state: "s".repeat(101),
      postalCode: "p".repeat(21),
      country: "c".repeat(101),
      addressLine1: "a".repeat(256),
      website: `https://${"w".repeat(500)}.test`,
    };
    for (const [field, value] of Object.entries(over)) {
      const res = await request(app)
        .patch(`/api/v1/companies/${ctx.companyB.id}`)
        .set(superHeaders())
        .send({ [field]: value });
      expect(res.status).toBe(422);
    }
  });

  it("rejects unknown and protected fields including logoPath", async () => {
    for (const body of [
      { logoPath: "companies/x/branding/evil.webp" },
      { contactEmail: "ok@example.test", logoPath: "x" },
      { status: "SUSPENDED" },
      { adminUserId: "11111111-1111-1111-1111-111111111111" },
      { googleSignInEnabled: false },
      { companyId: ctx.companyA.id },
      { favicon: "x" },
      { socialLinks: ["https://x.test"] },
    ]) {
      const res = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}`).set(superHeaders()).send(body);
      expect(res.status).toBe(422);
    }
  });

  it("empty PATCH bodies are rejected", async () => {
    const res = await request(app).patch(`/api/v1/companies/${ctx.companyB.id}`).set(superHeaders()).send({});
    expect(res.status).toBe(422);
  });
});

describe("profile audit payload", () => {
  it("same-value PATCH is a no-op with no audit row", async () => {
    const current = await prisma.company.findUnique({ where: { id: ctx.companyB.id } });
    const before = await prisma.auditLog.count({ where: { resource: "COMPANY", resourceId: ctx.companyB.id } });
    const res = await request(app)
      .patch(`/api/v1/companies/${ctx.companyB.id}`)
      .set(superHeaders())
      .send({ name: current.name, country: current.country });
    expect(res.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { resource: "COMPANY", resourceId: ctx.companyB.id } })).toBe(before);
  });

  it("genuine changes record exactly changedFields/previousValues", async () => {
    const before = await prisma.company.findUnique({ where: { id: ctx.companyB.id } });
    const res = await request(app)
      .patch(`/api/v1/companies/${ctx.companyB.id}`)
      .set(superHeaders())
      .send({ contactPhone: "+1-555-0199", city: "Shelbyville", country: "USA" });
    expect(res.status).toBe(200);
    const events = await prisma.auditLog.findMany({
      where: { resource: "COMPANY", resourceId: ctx.companyB.id, action: "UPDATED" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(events.length).toBe(1);
    expect(events[0].companyId).toBe(ctx.companyB.id);
    expect(events[0].details).toEqual({
      changedFields: ["contactPhone", "city"],
      previousValues: { contactPhone: before.contactPhone, city: before.city },
    });
  });

  it("audit details never carry secrets", async () => {
    const events = await prisma.auditLog.findMany({
      where: { resource: "COMPANY", resourceId: ctx.companyB.id },
    });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const serialized = JSON.stringify(event).toLowerCase();
      for (const leaked of ["password", "hash", "token", "secret", "otp"]) {
        expect(serialized).not.toContain(leaked);
      }
      expect(Object.keys(event.details || {}).sort()).toEqual(["changedFields", "previousValues"].sort());
    }
  });
});

describe("profile authorization and suspended manageability", () => {
  it("non-SUPER_ADMIN and anonymous callers are denied profile writes", async () => {
    const anon = await request(app)
      .patch(`/api/v1/companies/${ctx.companyB.id}`)
      .send({ city: "Nowhere" });
    expect(anon.status).toBe(401);
    for (const [tag, roles] of [["admin", ["ADMIN"]], ["head", ["HEAD"]], ["member", ["MEMBER"]], ["customer", ["CUSTOMER"]]]) {
      const res = await request(app)
        .patch(`/api/v1/companies/${ctx.companyB.id}`)
        .set(headersFor(ctx[tag].id, roles))
        .send({ city: "Nowhere" });
      expect(res.status).toBe(403);
    }
  });

  it("non-SUPER_ADMIN cannot read company detail", async () => {
    const res = await request(app).get(`/api/v1/companies/${ctx.companyB.id}`).set(headersFor(ctx.admin.id, ["ADMIN"]));
    expect(res.status).toBe(403);
  });

  it("a SUSPENDED company remains editable by SUPER_ADMIN", async () => {
    const suspend = await request(app).post(`/api/v1/companies/${ctx.companyB.id}/suspend`).set(superHeaders());
    expect(suspend.status).toBe(200);
    const edit = await request(app)
      .patch(`/api/v1/companies/${ctx.companyB.id}`)
      .set(superHeaders())
      .send({ contactEmail: "suspended@example.test" });
    expect(edit.status).toBe(200);
    expect(edit.body.data.company.contactEmail).toBe("suspended@example.test");
    const restore = await request(app).post(`/api/v1/companies/${ctx.companyB.id}/restore`).set(superHeaders());
    expect(restore.status).toBe(200);
  });
});

describe("company logo upload/removal", () => {
  it("accepts raster uploads, stamps a company-prefixed path, and serves detail", async () => {
    const res = await request(app)
      .post(`/api/v1/companies/${ctx.companyB.id}/logo`)
      .set(superHeaders())
      .attach("image", await pngBuffer(), { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    const logoPath = res.body.data.company.logoPath;
    expect(typeof logoPath).toBe("string");
    expect(logoPath.startsWith(`companies/${ctx.companyB.id}/branding/`)).toBe(true);
    expect(logoPath.endsWith(".webp")).toBe(true);
    ctx.logoPath = logoPath;
    const detail = await request(app).get(`/api/v1/companies/${ctx.companyB.id}`).set(superHeaders());
    expect(detail.body.data.company.logoPath).toBe(logoPath);
  });

  it("replaces the logo and removes the previous file", async () => {
    const previous = ctx.logoPath;
    const res = await request(app)
      .post(`/api/v1/companies/${ctx.companyB.id}/logo`)
      .set(superHeaders())
      .attach("image", await pngBuffer(), { filename: "logo2.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.data.company.logoPath).not.toBe(previous);
    ctx.logoPath = res.body.data.company.logoPath;
    const { localStorageAdapter } = require("../../src/modules/media/storage/local.storage.js");
    expect(await localStorageAdapter.exists(previous)).toBe(false);
    expect(await localStorageAdapter.exists(ctx.logoPath)).toBe(true);
  });

  it("rejects SVG and unsupported content", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await request(app)
      .post(`/api/v1/companies/${ctx.companyB.id}/logo`)
      .set(superHeaders())
      .attach("image", svg, { filename: "logo.svg", contentType: "image/svg+xml" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MEDIA_INVALID_TYPE");
    const spoofed = await request(app)
      .post(`/api/v1/companies/${ctx.companyB.id}/logo`)
      .set(superHeaders())
      .attach("image", svg, { filename: "logo.png", contentType: "image/png" });
    expect(spoofed.status).toBe(400);
    expect(spoofed.body.error.code).toBe("MEDIA_INVALID_TYPE");
  });

  it("rejects missing files and unknown companies, and denies non-SUPER_ADMIN", async () => {
    const empty = await request(app).post(`/api/v1/companies/${ctx.companyB.id}/logo`).set(superHeaders());
    expect(empty.status).toBe(400);
    const ghost = await request(app)
      .post("/api/v1/companies/00000000-0000-0000-0000-000000000000/logo")
      .set(superHeaders())
      .attach("image", await pngBuffer(), { filename: "logo.png", contentType: "image/png" });
    expect(ghost.status).toBe(404);
    const denied = await request(app)
      .post(`/api/v1/companies/${ctx.companyB.id}/logo`)
      .set(headersFor(ctx.admin.id, ["ADMIN"]))
      .attach("image", await pngBuffer(), { filename: "logo.png", contentType: "image/png" });
    expect(denied.status).toBe(403);
  });

  it("logo removal clears the column and deletes the file; repeat removal is a no-op", async () => {
    const current = ctx.logoPath;
    const res = await request(app).delete(`/api/v1/companies/${ctx.companyB.id}/logo`).set(superHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.company.logoPath).toBeNull();
    const { localStorageAdapter } = require("../../src/modules/media/storage/local.storage.js");
    expect(await localStorageAdapter.exists(current)).toBe(false);
    const again = await request(app).delete(`/api/v1/companies/${ctx.companyB.id}/logo`).set(superHeaders());
    expect(again.status).toBe(200);
    expect(again.body.data.company.logoPath).toBeNull();
    const denied = await request(app)
      .delete(`/api/v1/companies/${ctx.companyB.id}/logo`)
      .set(headersFor(ctx.admin.id, ["ADMIN"]));
    expect(denied.status).toBe(403);
  });

  it("company deletion cleanup includes branding files", async () => {
    const uploaded = await request(app)
      .post(`/api/v1/companies/${ctx.companyB.id}/logo`)
      .set(superHeaders())
      .attach("image", await pngBuffer(), { filename: "logo.png", contentType: "image/png" });
    expect(uploaded.status).toBe(201);
    const logoPath = uploaded.body.data.company.logoPath;
    const { localStorageAdapter } = require("../../src/modules/media/storage/local.storage.js");
    expect(await localStorageAdapter.exists(logoPath)).toBe(true);
    const suspend = await request(app).post(`/api/v1/companies/${ctx.companyB.id}/suspend`).set(superHeaders());
    expect(suspend.status).toBe(200);
    const stored = await prisma.company.findUnique({ where: { id: ctx.companyB.id } });
    const destroyed = await request(app)
      .delete(`/api/v1/companies/${ctx.companyB.id}`)
      .set(superHeaders())
      .send({ confirmName: stored.name });
    expect(destroyed.status).toBe(200);
    expect(await localStorageAdapter.exists(logoPath)).toBe(false);
    createdCompanyIds.splice(createdCompanyIds.indexOf(ctx.companyB.id), 1);
  });
});
