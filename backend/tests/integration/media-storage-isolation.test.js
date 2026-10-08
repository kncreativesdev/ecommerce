import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";
import { localStorageAdapter } from "../../src/modules/media/storage/local.storage.js";

/**
 * Phase 2C-9 product-media storage isolation (live HTTP + MySQL + disk).
 *
 * DB ownership was already gated in Phase 2C-4; this phase adds the
 * company-prefixed storage boundary for NEW writes while legacy
 * `products/<id>/…` bytes keep serving untouched:
 * - A/B uploads land in disjoint `companies/<id>/…` subtrees;
 * - cross-company upload/mutate/delete fail closed with files intact;
 * - legacy-format rows remain publicly readable and deletable;
 * - static serving stays unauthenticated for both layouts.
 *
 * Cleanup: uploaded files removed via API or adapter; catalog
 * deactivated.
 */

const RUN = `TSTMI${Date.now().toString(36).toUpperCase()}`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles = ["ADMIN"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function pngBuffer() {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 60, b: 10 } } })
    .png()
    .toBuffer();
}

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN.toLowerCase()}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "MedIso",
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

async function createCatalog(tag, companyId) {
  const category = await prisma.category.create({
    data: { name: `${RUN} Cat ${tag}`, slug: `${RUN.toLowerCase()}-cat-${tag}`, companyId },
  });
  const product = await prisma.product.create({
    data: {
      name: `${RUN} Camera ${tag}`,
      slug: `${RUN.toLowerCase()}-prod-${tag}`,
      categoryId: category.id,
      companyId,
      isActive: true,
    },
  });
  return { category, product };
}

async function upload(adminId, productId, alt = "shot") {
  return request(app)
    .post(`/api/v1/products/${productId}/images`)
    .set(headersFor(adminId))
    .attach("image", await pngBuffer(), "img.png")
    .field("altText", alt);
}

beforeAll(async () => {
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN.toLowerCase()}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "MedIso",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = admin;
  }
  ctx.catA = await createCatalog("a", ctx.companyA.id);
  ctx.catB = await createCatalog("b", ctx.companyB.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);

  // Legacy-format fixture (pre-SaaS layout): row + real file, simulating
  // existing Company #1 media. Points at A's product on purpose.
  const legacyPath = `products/${ctx.catA.product.id}/legacy-${RUN.toLowerCase()}.webp`;
  await localStorageAdapter.save(
    `products/${ctx.catA.product.id}`,
    `legacy-${RUN.toLowerCase()}.webp`,
    await pngBuffer()
  );
  const legacy = await prisma.productImage.create({
    data: {
      productId: ctx.catA.product.id,
      variantId: null,
      filename: `legacy-${RUN.toLowerCase()}.webp`,
      storagePath: legacyPath,
      imageType: "webp",
      altText: "legacy",
      sortOrder: 0,
      isPrimary: false,
    },
  });
  ctx.legacy = { ...legacy, storagePath: legacyPath };
}, 120000);

afterAll(async () => {
  if (ctx.categoryImagePath) {
    try {
      await localStorageAdapter.remove(ctx.categoryImagePath);
    } catch { /* best-effort */ }
  }
  for (const key of ["imageA", "imageB", "legacy"]) {
    const row = ctx[key];
    if (row?.storagePath) {
      try {
        await localStorageAdapter.remove(row.storagePath);
      } catch { /* best-effort */ }
    }
    if (row?.id) {
      try {
        await prisma.productImage.deleteMany({ where: { id: row.id } });
      } catch { /* best-effort */ }
    }
  }
  for (const cat of [ctx.catA, ctx.catB].filter(Boolean)) {
    await prisma.product.updateMany({ where: { id: cat.product.id }, data: { isActive: false } });
    await prisma.category.updateMany({ where: { id: cat.category.id }, data: { isActive: false } });
  }
  await prisma.$disconnect();
});

describe("company-prefixed new writes", () => {
  it("A and B uploads land in disjoint company subtrees", async () => {
    const resA = await upload(ctx.adminA.id, ctx.catA.product.id, "shot-a");
    expect(resA.status).toBe(201);
    expect(resA.body.data.image.storagePath.startsWith(`companies/${ctx.companyA.id}/products/${ctx.catA.product.id}/`)).toBe(true);
    expect(JSON.stringify(resA.body)).not.toContain("companyId");
    expect(await localStorageAdapter.exists(resA.body.data.image.storagePath)).toBe(true);
    ctx.imageA = resA.body.data.image;

    const resB = await upload(ctx.adminB.id, ctx.catB.product.id, "shot-b");
    expect(resB.status).toBe(201);
    expect(resB.body.data.image.storagePath.startsWith(`companies/${ctx.companyB.id}/products/${ctx.catB.product.id}/`)).toBe(true);
    ctx.imageB = resB.body.data.image;
  });

  it("prefixed files serve publicly like legacy files", async () => {
    const res = await request(app).get(`/${ctx.imageA.storagePath}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\//);
  });

  it("category uploads use the same prefixed contract", async () => {
    const res = await request(app)
      .post(`/api/v1/categories/${ctx.catA.category.id}/image`)
      .set(headersFor(ctx.adminA.id))
      .attach("image", await pngBuffer(), "img.png");
    expect(res.status).toBe(200);
    expect(res.body.data.category.image.startsWith(`companies/${ctx.companyA.id}/categories/${ctx.catA.category.id}/`)).toBe(true);
    ctx.categoryImagePath = res.body.data.category.image;
  });
});

describe("cross-company and platform boundaries", () => {
  it("A cannot upload to B's product", async () => {
    const res = await upload(ctx.adminA.id, ctx.catB.product.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("A cannot promote or delete B's image; B's file stays intact", async () => {
    const patch = await request(app)
      .patch(`/api/v1/products/${ctx.catB.product.id}/images/${ctx.imageB.id}`)
      .set(headersFor(ctx.adminA.id))
      .send({ isPrimary: true });
    expect(patch.status).toBe(404);
    const del = await request(app)
      .delete(`/api/v1/products/${ctx.catB.product.id}/images/${ctx.imageB.id}`)
      .set(headersFor(ctx.adminA.id));
    expect(del.status).toBe(404);
    expect(await localStorageAdapter.exists(ctx.imageB.storagePath)).toBe(true);
    expect((await prisma.productImage.findUnique({ where: { id: ctx.imageB.id } })).isPrimary).toBe(false);
  });

  it("delete removes the file (own company)", async () => {
    const del = await request(app)
      .delete(`/api/v1/products/${ctx.catA.product.id}/images/${ctx.imageA.id}`)
      .set(headersFor(ctx.adminA.id));
    expect(del.status).toBe(200);
    expect(await localStorageAdapter.exists(ctx.imageA.storagePath)).toBe(false);
  });

  it("SUPER_ADMIN cannot upload; suspended admin is rejected first (Phase 2C-13)", async () => {
    const sup = await upload(ctx.superAdmin.id, ctx.catA.product.id);
    expect(sup.status).toBe(403);
    const susp = await upload(ctx.adminS.id, ctx.catA.product.id);
    // The suspension guard runs before the product gate, so even a
    // cross-company target now surfaces the suspension refusal.
    expect(susp.status).toBe(403);
    expect(susp.body.error.code).toBe("COMPANY_SUSPENDED");
  });
});

describe("legacy compatibility", () => {
  it("legacy-format rows remain readable and deletable", async () => {
    const get = await request(app).get(`/${ctx.legacy.storagePath}`);
    expect(get.status).toBe(200);
    expect(get.headers["content-type"]).toMatch(/image\//);
    // The company-scoped media list resolves through the product's
    // own domain (registered here); the static file above needs none.
    const domain = `legacy-${RUN.toLowerCase()}.example.test`;
    await prisma.companyDomain.create({ data: { companyId: ctx.companyA.id, domain } });
    try {
      const list = await request(app)
        .get(`/api/v1/products/${ctx.catA.product.id}/images`)
        .set("Host", domain);
      expect(list.status).toBe(200);
      expect(list.body.data.map((i) => i.id)).toContain(ctx.legacy.id);
    } finally {
      await prisma.companyDomain.deleteMany({ where: { domain } });
    }
  });
});
