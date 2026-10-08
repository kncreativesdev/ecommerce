import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Phase 3-2 product RBAC slice (live HTTP + MySQL).
 *
 * Wires the permissions.js product grants without touching lifecycle,
 * isolation, suspension, validation, or audit semantics:
 * - POST /products + PATCH /products/:id → ADMIN/HEAD/MEMBER
 *   (MEMBER: no `isActive` anywhere in the payload — 403)
 * - DELETE /products/:id (delete-confirm on inactive rows = hard
 *   DELETE action) → ADMIN only
 * - variant endpoints → ADMIN only (later slice, untouched)
 * - product image POST + PATCH (UPDATE mapping) → ADMIN/HEAD/MEMBER
 * - product image DELETE (hard file + row delete) → ADMIN only
 * - reads stay public; inactive/all scopes stay ADMIN-only;
 *   SUPER_ADMIN/CUSTOMER stay excluded (403/401).
 *
 * Boundaries keep the pre-existing codes — cross-company and unknown
 * ids read as the neutral 404 — and mutations keep their
 * actor/company-scoped audit events.
 */

const RUN = `TSTPR${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const PASSWORD = "TestPass123!";

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function ensureRole(name) {
  let role = await prisma.role.findUnique({ where: { name } });
  if (!role) {
    role = await prisma.role.create({ data: { name } });
  }
  return role;
}

async function createStaff(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      firstName: "Prod",
      lastName: tag,
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await ensureRole(roleName);
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function createCategory(tag, companyId) {
  const row = await prisma.category.create({
    data: { name: `${RUN} ${tag}`, slug: `${RUN}-${tag}`, companyId },
  });
  return row;
}

async function pngBuffer() {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 60, b: 200 } } })
    .png()
    .toBuffer();
}

const productBody = (tag, extra = {}) => ({
  name: `${RUN} ${tag}`,
  categoryId: ctx.categoryA.id,
  variants: [{ sku: `${RUN}-${tag}-sku`, name: "Standard", price: "99.00" }],
  ...extra,
});

beforeAll(async () => {
  ctx.superAdmin = await createStaff("super", "SUPER_ADMIN", null);
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    // eslint-disable-next-line no-await-in-loop
    const company = await prisma.company.create({ data: { name: `${RUN} Prod Co ${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
  }
  ctx.adminA = await createStaff("admin-a", "ADMIN", ctx.companyA.id);
  await prisma.company.update({ where: { id: ctx.companyA.id }, data: { adminUserId: ctx.adminA.id } });
  ctx.headA = await createStaff("head-a", "HEAD", ctx.companyA.id);
  ctx.memberA = await createStaff("member-a", "MEMBER", ctx.companyA.id);
  ctx.customerA = await createStaff("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.adminB = await createStaff("admin-b", "ADMIN", ctx.companyB.id);
  await prisma.company.update({ where: { id: ctx.companyB.id }, data: { adminUserId: ctx.adminB.id } });
  ctx.headS = await createStaff("head-s", "HEAD", ctx.companyS.id);
  ctx.categoryA = await createCategory("cat-a", ctx.companyA.id);
  ctx.categoryB = await createCategory("cat-b", ctx.companyB.id);
}, 120000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { companyId: { in: createdCompanyIds } },
        { resourceId: { in: createdUserIds } },
        { actorId: { in: createdUserIds } },
      ],
    },
  });
  await prisma.productImage.deleteMany({ where: { product: { companyId: { in: createdCompanyIds } } } });
  await prisma.productVariant.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await prisma.product.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await prisma.category.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

const adminA = () => headersFor(ctx.adminA.id, ["ADMIN"]);
const headA = () => headersFor(ctx.headA.id, ["HEAD"]);
const memberA = () => headersFor(ctx.memberA.id, ["MEMBER"]);

describe("product create by role", () => {
  it("ADMIN creates with variants, flags, and company stamp (unchanged)", async () => {
    const res = await request(app).post("/api/v1/products").set(adminA()).send(
      productBody("admin", { isActive: false, isFeatured: true })
    );
    expect(res.status).toBe(201);
    expect(res.body.data.product).toMatchObject({ isActive: false, isFeatured: true });
    ctx.adminMadeId = res.body.data.product.id;
    const stored = await prisma.product.findUnique({
      where: { id: ctx.adminMadeId },
      select: { companyId: true, variants: { select: { companyId: true } } },
    });
    expect(stored.companyId).toBe(ctx.companyA.id);
    expect(stored.variants.map((variant) => variant.companyId)).toEqual([ctx.companyA.id]);
  });

  it("HEAD creates with nested variants, company-stamped", async () => {
    const res = await request(app).post("/api/v1/products").set(headA()).send(productBody("head"));
    expect(res.status).toBe(201);
    ctx.headMadeId = res.body.data.product.id;
    const stored = await prisma.product.findUnique({
      where: { id: ctx.headMadeId },
      select: { companyId: true, variants: { select: { companyId: true } } },
    });
    expect(stored.companyId).toBe(ctx.companyA.id);
    expect(stored.variants.map((variant) => variant.companyId)).toEqual([ctx.companyA.id]);
  });

  it("MEMBER creates active; inactive product or variant is refused with nothing stored", async () => {
    const ok = await request(app).post("/api/v1/products").set(memberA()).send(productBody("member"));
    expect(ok.status).toBe(201);
    ctx.memberMadeId = ok.body.data.product.id;

    const darkProduct = await request(app).post("/api/v1/products").set(memberA()).send(productBody("member-dark", { isActive: false }));
    expect(darkProduct.status).toBe(403);
    expect(darkProduct.body.error.code).toBe("AUTH_FORBIDDEN");

    const darkVariant = await request(app).post("/api/v1/products").set(memberA()).send(
      productBody("member-dark-variant", { variants: [{ sku: `${RUN}-dark-sku`, name: "Dark", price: "10.00", isActive: false }] })
    );
    expect(darkVariant.status).toBe(403);
    expect(await prisma.product.findFirst({ where: { name: { startsWith: `${RUN} member-dark` } } })).toBeNull();
  });

  it("CUSTOMER, SUPER_ADMIN, and anonymous callers are refused", async () => {
    const customer = await request(app).post("/api/v1/products").set(headersFor(ctx.customerA.id, ["CUSTOMER"])).send(productBody("nope-c"));
    expect(customer.status).toBe(403);
    const platform = await request(app).post("/api/v1/products").set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"])).send(productBody("nope-s"));
    expect(platform.status).toBe(403);
    const anonymous = await request(app).post("/api/v1/products").send(productBody("nope-a"));
    expect(anonymous.status).toBe(401);
  });

  it("body companyId smuggling is rejected; query companyId is ignored; foreign category reads as missing", async () => {
    const smuggled = await request(app).post("/api/v1/products").set(headA()).send({ ...productBody("smuggled"), companyId: ctx.companyB.id });
    expect(smuggled.status).toBe(422);

    const scoped = await request(app).post(`/api/v1/products?companyId=${ctx.companyB.id}`).set(headA()).send(productBody("scoped"));
    expect(scoped.status).toBe(201);
    const stored = await prisma.product.findUnique({ where: { id: scoped.body.data.product.id }, select: { companyId: true } });
    expect(stored.companyId).toBe(ctx.companyA.id);

    const foreignCategory = await request(app).post("/api/v1/products").set(headA()).send({ ...productBody("foreign-cat"), categoryId: ctx.categoryB.id });
    expect(foreignCategory.status).toBe(404);
    expect(foreignCategory.body.error.code).toBe("CATEGORY_NOT_FOUND");
  });
});

describe("product update by role", () => {
  it("MEMBER updates fields but cannot touch isActive either way", async () => {
    const ok = await request(app).patch(`/api/v1/products/${ctx.memberMadeId}`).set(memberA()).send({ brand: "member brand", isFeatured: true });
    expect(ok.status).toBe(200);
    expect(ok.body.data.product).toMatchObject({ brand: "member brand", isFeatured: true });

    for (const isActive of [false, true]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).patch(`/api/v1/products/${ctx.memberMadeId}`).set(memberA()).send({ isActive });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    }
    const stored = await prisma.product.findUnique({ where: { id: ctx.memberMadeId } });
    expect(stored).toMatchObject({ isActive: true, brand: "member brand" });
  });

  it("HEAD deactivates through the guarded path and reactivates; ADMIN unchanged", async () => {
    const off = await request(app).patch(`/api/v1/products/${ctx.headMadeId}`).set(headA()).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.product.isActive).toBe(false);
    const on = await request(app).patch(`/api/v1/products/${ctx.headMadeId}`).set(headA()).send({ isActive: true });
    expect(on.status).toBe(200);
    expect(on.body.data.product.isActive).toBe(true);

    const adminFlip = await request(app).patch(`/api/v1/products/${ctx.headMadeId}`).set(adminA()).send({ brand: "admin brand", isActive: false });
    expect(adminFlip.status).toBe(200);
    expect(adminFlip.body.data.product).toMatchObject({ brand: "admin brand", isActive: false });
    const back = await request(app).patch(`/api/v1/products/${ctx.headMadeId}`).set(adminA()).send({ isActive: true });
    expect(back.status).toBe(200);
  });
});

describe("product delete-confirm stays ADMIN-only", () => {
  it("HEAD and MEMBER cannot reach the delete-confirm path at all", async () => {
    // The route stays authorize("ADMIN"): HEAD/MEMBER are refused by
    // the role gate before any lifecycle logic runs (403, not 409).
    const headDelete = await request(app).delete(`/api/v1/products/${ctx.headMadeId}`).set(headA());
    expect(headDelete.status).toBe(403);
    const memberDelete = await request(app).delete(`/api/v1/products/${ctx.headMadeId}`).set(memberA());
    expect(memberDelete.status).toBe(403);
    expect((await prisma.product.findUnique({ where: { id: ctx.headMadeId } })).isActive).toBe(true);
  });

  it("ADMIN delete-confirm semantics preserved (409 active, 200 once inactive)", async () => {
    const made = await request(app).post("/api/v1/products").set(adminA()).send(productBody("doomed"));
    expect(made.status).toBe(201);
    const id = made.body.data.product.id;

    const activeGuard = await request(app).delete(`/api/v1/products/${id}`).set(adminA());
    expect(activeGuard.status).toBe(409);
    expect(activeGuard.body.error.code).toBe("PRODUCT_ACTIVE_CANNOT_DELETE");

    await request(app).patch(`/api/v1/products/${id}`).set(adminA()).send({ isActive: false });
    const confirmed = await request(app).delete(`/api/v1/products/${id}`).set(adminA());
    expect(confirmed.status).toBe(200);
  });

  it("variant standalone create follows the Phase 3-3 contract (full matrix in variant-rbac)", async () => {
    const payload = { sku: `${RUN}-nope-sku`, name: "Nope", price: "5.00" };
    expect((await request(app).post(`/api/v1/products/${ctx.headMadeId}/variants`).set(headA()).send(payload)).status).toBe(201);
    expect((await request(app).post(`/api/v1/products/${ctx.headMadeId}/variants`).set(memberA()).send({ ...payload, sku: `${RUN}-nope2-sku` })).status).toBe(201);
  });
});

describe("product tenant and suspension boundaries", () => {
  it("suspended-company mutations stay blocked for HEAD and MEMBER", async () => {
    const headS = headersFor(ctx.headS.id, ["HEAD"]);
    const res = await request(app).post("/api/v1/products").set(headS).send({ ...productBody("suspended"), categoryId: ctx.categoryA.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
  });

  it("cross-company product ids read as neutral 404 with nothing changed", async () => {
    const foreign = await prisma.product.create({
      data: { name: `${RUN} Foreign`, slug: `${RUN}-foreign`, categoryId: ctx.categoryB.id, companyId: ctx.companyB.id },
    });
    for (const res of [
      await request(app).patch(`/api/v1/products/${foreign.id}`).set(headA()).send({ brand: "x" }),
      await request(app).patch(`/api/v1/products/${foreign.id}`).set(memberA()).send({ brand: "x" }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
    }
    // The ADMIN-only DELETE route refuses HEAD by role before any
    // company scoping runs — authorization precedes isolation there.
    const headDelete = await request(app).delete(`/api/v1/products/${foreign.id}`).set(headA());
    expect(headDelete.status).toBe(403);
    expect((await prisma.product.findUnique({ where: { id: foreign.id } })).brand).toBeNull();
    await prisma.product.delete({ where: { id: foreign.id } });
  });
});

describe("product images by role", () => {
  it("HEAD and MEMBER upload + update metadata; CUSTOMER refused", async () => {
    const headUpload = await request(app).post(`/api/v1/products/${ctx.headMadeId}/images`).set(headA()).attach("image", await pngBuffer(), "img.png");
    expect(headUpload.status).toBe(201);
    ctx.headImageId = headUpload.body.data.image.id;

    const memberUpload = await request(app).post(`/api/v1/products/${ctx.headMadeId}/images`).set(memberA()).attach("image", await pngBuffer(), "img.png");
    expect(memberUpload.status).toBe(201);
    ctx.memberImageId = memberUpload.body.data.image.id;

    const memberMeta = await request(app).patch(`/api/v1/products/${ctx.headMadeId}/images/${ctx.memberImageId}`).set(memberA()).send({ altText: "member alt" });
    expect(memberMeta.status).toBe(200);
    expect(memberMeta.body.data.image.altText).toBe("member alt");

    const customerUpload = await request(app).post(`/api/v1/products/${ctx.headMadeId}/images`).set(headersFor(ctx.customerA.id, ["CUSTOMER"])).attach("image", await pngBuffer(), "img.png");
    expect(customerUpload.status).toBe(403);
  });

  it("image hard-delete stays ADMIN-only", async () => {
    expect((await request(app).delete(`/api/v1/products/${ctx.headMadeId}/images/${ctx.memberImageId}`).set(headA())).status).toBe(403);
    expect((await request(app).delete(`/api/v1/products/${ctx.headMadeId}/images/${ctx.memberImageId}`).set(memberA())).status).toBe(403);
    const adminDelete = await request(app).delete(`/api/v1/products/${ctx.headMadeId}/images/${ctx.memberImageId}`).set(adminA());
    expect(adminDelete.status).toBe(200);
    const headDelete = await request(app).delete(`/api/v1/products/${ctx.headMadeId}/images/${ctx.headImageId}`).set(headA());
    expect(headDelete.status).toBe(403);
    const adminDeleteHead = await request(app).delete(`/api/v1/products/${ctx.headMadeId}/images/${ctx.headImageId}`).set(adminA());
    expect(adminDeleteHead.status).toBe(200);
  });

  it("foreign-product images read as neutral not-found", async () => {
    const foreign = await prisma.product.create({
      data: { name: `${RUN} Foreign Img`, slug: `${RUN}-foreign-img`, categoryId: ctx.categoryB.id, companyId: ctx.companyB.id },
    });
    const upload = await request(app).post(`/api/v1/products/${foreign.id}/images`).set(headA()).attach("image", await pngBuffer(), "img.png");
    expect(upload.status).toBe(404);
    expect(upload.body.error.code).toBe("PRODUCT_NOT_FOUND");
    const ghost = await request(app).post("/api/v1/products/00000000-0000-0000-0000-000000000000/images").set(headA()).attach("image", await pngBuffer(), "img.png");
    expect(ghost.status).toBe(404);
    expect(upload.body).toEqual(ghost.body);
    await prisma.product.delete({ where: { id: foreign.id } });
  });
});

describe("product RBAC audit", () => {
  it("records HEAD/MEMBER actor snapshots with safe metadata", async () => {
    const events = await prisma.auditLog.findMany({
      where: { companyId: ctx.companyA.id, resource: "PRODUCT" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.length).toBeGreaterThan(0);
    const roles = new Set(events.map((event) => event.actorRole));
    expect(roles.has("HEAD")).toBe(true);
    expect(roles.has("MEMBER")).toBe(true);
    expect(roles.has("ADMIN")).toBe(true);
    for (const event of events) {
      expect(event.companyId).toBe(ctx.companyA.id);
      expect(["CREATED", "UPDATED", "DEACTIVATED", "REACTIVATED", "DELETED"]).toContain(event.action);
      expect(event.outcome).toBe("SUCCESS");
      const serialized = JSON.stringify(event);
      for (const leaked of ["password", "secret", "token"]) {
        expect(serialized.toLowerCase()).not.toContain(leaked);
      }
    }
    const headCreated = events.find((event) => event.action === "CREATED" && event.actorRole === "HEAD");
    expect(headCreated.details).toMatchObject({ name: `${RUN} head` });
  });

  it("refused mutations emit no audit event", async () => {
    const before = await prisma.auditLog.count({ where: { resource: "PRODUCT" } });
    const refused = await request(app).post("/api/v1/products").set(memberA()).send(productBody("audit-dark", { isActive: false }));
    expect(refused.status).toBe(403);
    const forbidden = await request(app).delete(`/api/v1/products/${ctx.headMadeId}`).set(memberA());
    expect(forbidden.status).toBe(403);
    expect(await prisma.auditLog.count({ where: { resource: "PRODUCT" } })).toBe(before);
  });
});
