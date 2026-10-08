import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";
import { COMPANY_ONE_ID } from "../helpers/userFixtures.js";

/**
 * Phase 2C-4 catalog tenant isolation (live HTTP + MySQL).
 *
 * Dedicated companies A, B, and S(uspended) with catalog created
 * through the real ADMIN APIs (which also proves creator stamping).
 * Public reads stay global by design; every authenticated company
 * operation must stay inside its company. Cross-company ids fail
 * exactly like unknown ids (no name/sku/price/image leakage).
 *
 * Cleanup: images deleted via API (file + row), catalog deactivated.
 */

const RUN = `TSTCI${Date.now().toString(36).toUpperCase()}`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

// Phase 2C-26: public reads fail closed on unregistered hosts, so the
// Company #1 storefront assertions below resolve through an explicit
// RUN-unique test domain (created here, removed in afterAll) instead
// of ambient localhost state. Company #1 itself stays read-only.
const PUBLIC_HOST = `${RUN.toLowerCase()}-public-1.example.test`;
let publicDomainId = null;

const headersFor = (id, roles = ["ADMIN"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function pngBuffer() {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png()
    .toBuffer();
}

async function createCompany(tag, status = "ACTIVE") {
  const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
  createdCompanyIds.push(company.id);
  const admin = await provisionCompanyAdmin(company.id, {
    email: `${RUN.toLowerCase()}-admin-${tag}@example.test`,
    password: "TestPass123!",
    firstName: "CatIso",
    lastName: `Admin${tag.toUpperCase()}`,
  });
  createdUserIds.push(admin.id);
  return { company, admin };
}

async function createCategory(adminId, name) {
  const res = await request(app)
    .post("/api/v1/categories")
    .set(headersFor(adminId))
    .send({ name });
  expect(res.status).toBe(201);
  return res.body.data.category;
}

async function createProduct(adminId, name, categoryId, sku) {
  const res = await request(app)
    .post("/api/v1/products")
    .set(headersFor(adminId))
    .send({ name, categoryId, variants: [{ sku, name: `${name} base`, price: "99.00" }] });
  expect(res.status).toBe(201);
  return res.body.data.product;
}

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN.toLowerCase()}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "CatIso",
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
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    const { company, admin } = await createCompany(tag, status);
    ctx[`company${tag.toUpperCase()}`] = company;
    ctx[`admin${tag.toUpperCase()}`] = admin;
  }
  ctx.catA = await createCategory(ctx.adminA.id, `${RUN} Category A`);
  ctx.catB = await createCategory(ctx.adminB.id, `${RUN} Category B`);
  ctx.productA = await createProduct(ctx.adminA.id, `${RUN} Widget A`, ctx.catA.id, `${RUN}-A1`);
  ctx.productB = await createProduct(ctx.adminB.id, `${RUN} Widget B`, ctx.catB.id, `${RUN}-B1`);
  ctx.variantA = ctx.productA.variants[0];
  ctx.variantB = ctx.productB.variants[0];
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);

  for (const [key, adminId, product] of [["A", ctx.adminA.id, ctx.productA], ["B", ctx.adminB.id, ctx.productB]]) {
    const res = await request(app)
      .post(`/api/v1/products/${product.id}/images`)
      .set(headersFor(adminId))
      .attach("image", await pngBuffer(), "img.png")
      .field("altText", `Image ${key}`);
    expect(res.status).toBe(201);
    ctx[`image${key}`] = res.body.data.image;
  }

  const publicDomain = await prisma.companyDomain.create({
    data: { companyId: COMPANY_ONE_ID, domain: PUBLIC_HOST, isPrimary: false, isActive: true },
  });
  publicDomainId = publicDomain.id;
}, 120000);

afterAll(async () => {
  if (publicDomainId) {
    await prisma.companyDomain.deleteMany({ where: { id: publicDomainId } });
  }  for (const key of ["A", "B"]) {
    const image = ctx[`image${key}`];
    const admin = ctx[`admin${key}`];
    const product = ctx[`product${key}`];
    if (image && admin && product) {
      try {
        await request(app)
          .delete(`/api/v1/products/${product.id}/images/${image.id}`)
          .set(headersFor(admin.id));
      } catch { /* best-effort */ }
    }
  }
  for (const key of ["A", "B", "S"]) {
    const product = ctx[`product${key}`];
    const cat = ctx[`cat${key}`];
    if (product) {
      await prisma.productVariant.updateMany({ where: { productId: product.id }, data: { isActive: false } });
      await prisma.product.updateMany({ where: { id: product.id }, data: { isActive: false } });
    }
    if (cat) {
      await prisma.category.updateMany({ where: { id: cat.id }, data: { isActive: false } });
    }
  }
  await prisma.$disconnect();
});

const adminA = () => headersFor(ctx.adminA.id);
const adminB = () => headersFor(ctx.adminB.id);

describe("category isolation", () => {
  it("A lists only its own categories", async () => {
    const res = await request(app).get("/api/v1/categories").query({ status: "all" }).set(adminA());
    expect(res.status).toBe(200);
    const ids = res.body.data.map((c) => c.id);
    expect(ids).toContain(ctx.catA.id);
    expect(ids).not.toContain(ctx.catB.id);
  });

  it("A cannot read B's category by exact id", async () => {
    const res = await request(app).get(`/api/v1/categories/${ctx.catB.id}`).query({ status: "all" }).set(adminA());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CATEGORY_NOT_FOUND");
    expect(JSON.stringify(res.body)).not.toContain(ctx.catB.name);
  });

  it("A cannot update/deactivate B's category", async () => {
    const patch = await request(app)
      .patch(`/api/v1/categories/${ctx.catB.id}`)
      .set(adminA())
      .send({ name: "Hijacked" });
    expect(patch.status).toBe(404);
    const del = await request(app).delete(`/api/v1/categories/${ctx.catB.id}`).set(adminA());
    expect(del.status).toBe(404);
    const reactivate = await request(app)
      .patch(`/api/v1/categories/${ctx.catB.id}`)
      .set(adminA())
      .send({ isActive: true });
    expect(reactivate.status).toBe(404);
    const reread = await prisma.category.findUnique({ where: { id: ctx.catB.id } });
    expect(reread.name).toBe(ctx.catB.name);
    expect(reread.isActive).toBe(true);
  });
});

describe("product isolation", () => {
  it("A lists only its own products", async () => {
    const res = await request(app).get("/api/v1/products").query({ status: "all" }).set(adminA());
    expect(res.status).toBe(200);
    const ids = res.body.data.map((p) => p.id);
    expect(ids).toContain(ctx.productA.id);
    expect(ids).not.toContain(ctx.productB.id);
  });

  it("A cannot retrieve B's product by exact id (no field leakage)", async () => {
    const res = await request(app).get(`/api/v1/products/${ctx.productB.id}`).query({ status: "all" }).set(adminA());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(ctx.productB.name);
    expect(body).not.toContain(ctx.variantB.sku);
  });

  it("A cannot update/deactivate/delete B's product", async () => {
    const patch = await request(app)
      .patch(`/api/v1/products/${ctx.productB.id}`)
      .set(adminA())
      .send({ name: "Hijacked" });
    expect(patch.status).toBe(404);
    const deactivate = await request(app)
      .patch(`/api/v1/products/${ctx.productB.id}`)
      .set(adminA())
      .send({ isActive: false });
    expect(deactivate.status).toBe(404);
    // B's product is active: an unscoped delete would 409 with its NAME.
    // Scoped resolution must 404 first — never revealing the name.
    const del = await request(app).delete(`/api/v1/products/${ctx.productB.id}`).set(adminA());
    expect(del.status).toBe(404);
    expect(JSON.stringify(del.body)).not.toContain(ctx.productB.name);
    const reread = await prisma.product.findUnique({ where: { id: ctx.productB.id } });
    expect(reread.name).toBe(ctx.productB.name);
    expect(reread.isActive).toBe(true);
  });

  it("A cannot create a product under B's category", async () => {
    const res = await request(app)
      .post("/api/v1/products")
      .set(adminA())
      .send({ name: `${RUN} Smuggled`, categoryId: ctx.catB.id });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CATEGORY_NOT_FOUND");
  });

  it("A cannot move its product into B's category", async () => {
    const res = await request(app)
      .patch(`/api/v1/products/${ctx.productA.id}`)
      .set(adminA())
      .send({ categoryId: ctx.catB.id });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CATEGORY_NOT_FOUND");
    const reread = await prisma.product.findUnique({ where: { id: ctx.productA.id } });
    expect(reread.categoryId).toBe(ctx.catA.id);
  });
});

describe("variant isolation", () => {
  it("A operates its own variant", async () => {
    const res = await request(app)
      .patch(`/api/v1/products/${ctx.productA.id}/variants/${ctx.variantA.id}`)
      .set(adminA())
      .send({ name: "Renamed base" });
    expect(res.status).toBe(200);
  });

  it("A cannot touch B's variant through either product pairing", async () => {
    for (const productId of [ctx.productA.id, ctx.productB.id]) {
      const patch = await request(app)
        .patch(`/api/v1/products/${productId}/variants/${ctx.variantB.id}`)
        .set(adminA())
        .send({ name: "Hijacked" });
      expect(patch.status).toBe(404);
      expect(patch.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
      const deactivate = await request(app)
        .delete(`/api/v1/products/${productId}/variants/${ctx.variantB.id}`)
        .set(adminA());
      expect(deactivate.status).toBe(404);
    }
    const reread = await prisma.productVariant.findUnique({ where: { id: ctx.variantB.id } });
    expect(reread.name).toBe(ctx.variantB.name);
    expect(reread.isActive).toBe(true);
  });

  it("variants cannot be moved across products/companies", async () => {
    // productId is not an updatable field: strict validation rejects it,
    // so no update payload can reattach a variant elsewhere.
    const res = await request(app)
      .patch(`/api/v1/products/${ctx.productA.id}/variants/${ctx.variantA.id}`)
      .set(adminA())
      .send({ name: "Still here", productId: ctx.productB.id });
    expect(res.status).toBe(422);
    const reread = await prisma.productVariant.findUnique({ where: { id: ctx.variantA.id } });
    expect(reread.productId).toBe(ctx.productA.id);
    expect(reread.companyId).toBe(ctx.companyA.id);
  });

  it("variant creation inherits the product's company; B products reject A creators", async () => {
    const created = await request(app)
      .post(`/api/v1/products/${ctx.productA.id}/variants`)
      .set(adminA())
      .send({ sku: `${RUN}-A2`, name: "Second", price: "10.00" });
    expect(created.status).toBe(201);
    const stored = await prisma.productVariant.findUnique({ where: { id: created.body.data.variant.id } });
    expect(stored.companyId).toBe(ctx.companyA.id);
    await prisma.productVariant.delete({ where: { id: stored.id } });
    const cross = await request(app)
      .post(`/api/v1/products/${ctx.productB.id}/variants`)
      .set(adminA())
      .send({ sku: `${RUN}-X1`, name: "Smuggled", price: "10.00" });
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });
});

describe("product image isolation", () => {
  it("A cannot upload to B's product", async () => {
    const res = await request(app)
      .post(`/api/v1/products/${ctx.productB.id}/images`)
      .set(adminA())
      .attach("image", await pngBuffer(), "img.png");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("A cannot update or delete B's image", async () => {
    // The product gate fires first (PRODUCT_NOT_FOUND): the request never
    // reaches image resolution, so neither the image nor the product
    // leaks. Either 404 shape is equally opaque to the caller.
    const patch = await request(app)
      .patch(`/api/v1/products/${ctx.productB.id}/images/${ctx.imageB.id}`)
      .set(adminA())
      .send({ altText: "Hijacked" });
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe("PRODUCT_NOT_FOUND");
    const del = await request(app)
      .delete(`/api/v1/products/${ctx.productB.id}/images/${ctx.imageB.id}`)
      .set(adminA());
    expect(del.status).toBe(404);
    expect(del.body.error.code).toBe("PRODUCT_NOT_FOUND");
    expect(await prisma.productImage.findUnique({ where: { id: ctx.imageB.id } })).not.toBeNull();
  });
});

describe("override channels, platform, suspension, public reads", () => {
  it("body companyId is rejected; query/header ids are ignored", async () => {
    const strict = await request(app)
      .post("/api/v1/products")
      .set(adminA())
      .send({ name: `${RUN} Smuggled`, categoryId: ctx.catA.id, companyId: ctx.companyB.id });
    expect(strict.status).toBe(422);
    const ignored = await request(app)
      .post("/api/v1/categories")
      .query({ companyId: ctx.companyB.id })
      .set({ ...adminA(), "x-company-id": ctx.companyB.id })
      .send({ name: `${RUN} Own Category` });
    expect(ignored.status).toBe(201);
    const stored = await prisma.category.findUnique({ where: { id: ignored.body.data.category.id } });
    expect(stored.companyId).toBe(ctx.companyA.id);
    await prisma.category.delete({ where: { id: stored.id } });
  });

  it("SUPER_ADMIN gains no catalog operational bypass", async () => {
    const headers = { Authorization: `Bearer ${signAccessToken({ id: ctx.superAdmin.id, roles: ["SUPER_ADMIN"] })}` };
    const write = await request(app).post("/api/v1/products").set(headers).send({
      name: `${RUN} Super`,
      categoryId: ctx.catA.id,
    });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("suspended company admin is rejected (Phase 2C-13)", async () => {
    const res = await request(app)
      .post("/api/v1/categories")
      .set(headersFor(ctx.adminS.id))
      .send({ name: `${RUN} Susp Category` });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
  });

  it("public catalog reads stay open per resolved company (Phase 2C-12)", async () => {
    // Company #1's storefront resolves through the explicit test domain.
    const products = await request(app).get("/api/v1/products").set("Host", PUBLIC_HOST);
    expect(products.status).toBe(200);
    expect(products.body.data.length).toBeGreaterThan(0);
    const categories = await request(app).get("/api/v1/categories").set("Host", PUBLIC_HOST);
    expect(categories.status).toBe(200);
    // Dedicated-company rows resolve through their own domain.
    const domain = `${RUN}-store-b.example.test`.toLowerCase();
    await prisma.companyDomain.create({ data: { companyId: ctx.companyB.id, domain } });
    try {
      const images = await request(app).get(`/api/v1/products/${ctx.productB.id}/images`).set("Host", domain);
      expect(images.status).toBe(200);
      const reviews = await request(app).get(`/api/v1/reviews/product/${ctx.productB.id}`).set("Host", domain);
      expect(reviews.status).toBe(200);
    } finally {
      await prisma.companyDomain.deleteMany({ where: { domain } });
    }
  });
});
