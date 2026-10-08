import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Phase 3-4 inventory RBAC slice (live HTTP + MySQL).
 *
 * Inventory carries an explicit namespace in permissions.js — ADMIN +
 * HEAD hold CREATE/READ/UPDATE/DEACTIVATE, MEMBER holds
 * CREATE/READ/UPDATE — and every endpoint is one of those three
 * actions (no deactivation/deletion endpoint exists, so DEACTIVATE
 * wires nothing and no service guard is needed):
 * - POST …/inventory (initialize = CREATE) → ADMIN/HEAD/MEMBER
 * - PATCH …/inventory (adjust ±delta = UPDATE) → ADMIN/HEAD/MEMBER
 * - GET …/inventory + …/transactions + GET /inventory (READ) →
 *   ADMIN/HEAD/MEMBER
 * - SUPER_ADMIN/CUSTOMER excluded everywhere (403/401).
 *
 * Authorization and business validation stay separate: insufficient
 * stock and invalid quantities keep their business/validation codes,
 * and refused requests change no quantity, ledger, or audit state.
 * Transactions, arithmetic, and ledger semantics are untouched.
 */

const RUN = `TSTIR${Date.now().toString(36).toUpperCase()}`.toLowerCase();
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
      firstName: "Inv",
      lastName: tag,
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await ensureRole(roleName);
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function createCatalog(tag, companyId) {
  const category = await prisma.category.create({
    data: { name: `${RUN} ${tag}`, slug: `${RUN}-${tag}`, companyId },
  });
  const product = await prisma.product.create({
    data: { name: `${RUN} ${tag} prod`, slug: `${RUN}-${tag}-prod`, categoryId: category.id, companyId },
  });
  return { category, product };
}

async function createVariant(productId, tag, companyId) {
  return prisma.productVariant.create({
    data: { productId, sku: `${RUN}-${tag}-sku`, name: `${RUN} ${tag}`, price: "10.00", companyId },
  });
}

const invPath = (productId, variantId, suffix = "") => `/api/v1/products/${productId}/variants/${variantId}/inventory${suffix}`;

async function ledgerCount(variantId) {
  return prisma.inventoryTransaction.count({ where: { inventory: { variantId } } });
}

async function quantityOf(variantId) {
  const row = await prisma.inventory.findUnique({ where: { variantId } });
  return row ? row.quantity : null;
}

beforeAll(async () => {
  ctx.superAdmin = await createStaff("super", "SUPER_ADMIN", null);
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    // eslint-disable-next-line no-await-in-loop
    const company = await prisma.company.create({ data: { name: `${RUN} Inv Co ${tag}`, status } });
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

  const catA = await createCatalog("cat-a", ctx.companyA.id);
  ctx.productA = catA.product;
  const catB = await createCatalog("cat-b", ctx.companyB.id);
  ctx.productB = catB.product;
  const catS = await createCatalog("cat-s", ctx.companyS.id);
  ctx.productS = catS.product;

  ctx.variantA1 = await createVariant(ctx.productA.id, "a1", ctx.companyA.id);
  ctx.variantA2 = await createVariant(ctx.productA.id, "a2", ctx.companyA.id);
  ctx.variantA3 = await createVariant(ctx.productA.id, "a3", ctx.companyA.id);
  ctx.variantB1 = await createVariant(ctx.productB.id, "b1", ctx.companyB.id);
  ctx.variantS1 = await createVariant(ctx.productS.id, "s1", ctx.companyS.id);

  // Seed variantA2 stock through the ADMIN API (also proves ADMIN init).
  const seed = await request(app)
    .post(invPath(ctx.productA.id, ctx.variantA2.id))
    .set(headersFor(ctx.adminA.id, ["ADMIN"]))
    .send({ quantity: 10 });
  expect(seed.status).toBe(201);
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
  const variantWhere = { companyId: { in: createdCompanyIds } };
  await prisma.inventoryTransaction.deleteMany({ where: { inventory: { variant: variantWhere } } });
  await prisma.inventory.deleteMany({ where: { variant: variantWhere } });
  await prisma.productVariant.deleteMany({ where: variantWhere });
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

describe("inventory initialize by role", () => {
  it("HEAD initializes with ledger + audit", async () => {
    const res = await request(app).post(invPath(ctx.productA.id, ctx.variantA3.id)).set(headA()).send({ quantity: 7 });
    expect(res.status).toBe(201);
    expect(res.body.data.inventory).toMatchObject({ quantity: 7 });
    expect(await ledgerCount(ctx.variantA3.id)).toBe(1);
  });

  it("MEMBER initializes; duplicate initialize stays 409", async () => {
    const res = await request(app).post(invPath(ctx.productA.id, ctx.variantA1.id)).set(memberA()).send({ quantity: 4 });
    expect(res.status).toBe(201);
    expect(res.body.data.inventory).toMatchObject({ quantity: 4 });

    const dupe = await request(app).post(invPath(ctx.productA.id, ctx.variantA1.id)).set(memberA()).send({ quantity: 4 });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe("INVENTORY_ALREADY_EXISTS");
  });

  it("CUSTOMER, SUPER_ADMIN, and anonymous callers are refused with nothing stored", async () => {
    const customer = await request(app).post(invPath(ctx.productA.id, ctx.variantA2.id)).set(headersFor(ctx.customerA.id, ["CUSTOMER"])).send({ quantity: 1 });
    expect(customer.status).toBe(403);
    const platform = await request(app).post(invPath(ctx.productA.id, ctx.variantA2.id)).set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"])).send({ quantity: 1 });
    expect(platform.status).toBe(403);
    const anonymous = await request(app).post(invPath(ctx.productA.id, ctx.variantA2.id)).send({ quantity: 1 });
    expect(anonymous.status).toBe(401);
  });
});

describe("inventory adjust by role", () => {
  it("MEMBER adjusts positive and negative with ledger + quantity proofs", async () => {
    const before = await ledgerCount(ctx.variantA2.id);
    const up = await request(app).patch(invPath(ctx.productA.id, ctx.variantA2.id)).set(memberA()).send({ quantity: 5 });
    expect(up.status).toBe(200);
    expect(up.body.data.inventory.quantity).toBe(15);
    const down = await request(app).patch(invPath(ctx.productA.id, ctx.variantA2.id)).set(memberA()).send({ quantity: -3 });
    expect(down.status).toBe(200);
    expect(down.body.data.inventory.quantity).toBe(12);
    expect(await ledgerCount(ctx.variantA2.id)).toBe(before + 2);
  });

  it("HEAD and ADMIN adjust; business errors stay business errors, not auth errors", async () => {
    const head = await request(app).patch(invPath(ctx.productA.id, ctx.variantA1.id)).set(headA()).send({ quantity: 2 });
    expect(head.status).toBe(200);
    expect(head.body.data.inventory.quantity).toBe(6);
    const admin = await request(app).patch(invPath(ctx.productA.id, ctx.variantA1.id)).set(adminA()).send({ quantity: -1 });
    expect(admin.status).toBe(200);
    expect(admin.body.data.inventory.quantity).toBe(5);

    const qtyBefore = await quantityOf(ctx.variantA2.id);
    const ledgerBefore = await ledgerCount(ctx.variantA2.id);
    const overdraw = await request(app).patch(invPath(ctx.productA.id, ctx.variantA2.id)).set(memberA()).send({ quantity: -1000 });
    expect(overdraw.status).toBe(409);
    expect(overdraw.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await quantityOf(ctx.variantA2.id)).toBe(qtyBefore);
    expect(await ledgerCount(ctx.variantA2.id)).toBe(ledgerBefore);

    const zero = await request(app).patch(invPath(ctx.productA.id, ctx.variantA2.id)).set(memberA()).send({ quantity: 0 });
    expect(zero.status).toBe(422);
    const fraction = await request(app).patch(invPath(ctx.productA.id, ctx.variantA2.id)).set(memberA()).send({ quantity: 1.5 });
    expect(fraction.status).toBe(422);
  });

  it("CUSTOMER adjust stays forbidden with state untouched", async () => {
    const qtyBefore = await quantityOf(ctx.variantA2.id);
    const res = await request(app).patch(invPath(ctx.productA.id, ctx.variantA2.id)).set(headersFor(ctx.customerA.id, ["CUSTOMER"])).send({ quantity: 1 });
    expect(res.status).toBe(403);
    expect(await quantityOf(ctx.variantA2.id)).toBe(qtyBefore);
  });
});

describe("inventory reads by role", () => {
  it("HEAD and MEMBER read detail, ledger, and cross-variant list", async () => {
    for (const headers of [headA(), memberA()]) {
      // eslint-disable-next-line no-await-in-loop
      const detail = await request(app).get(invPath(ctx.productA.id, ctx.variantA2.id)).set(headers);
      expect(detail.status).toBe(200);
      expect(detail.body.data.inventory.quantity).toBe(12);
      // eslint-disable-next-line no-await-in-loop
      const ledger = await request(app).get(invPath(ctx.productA.id, ctx.variantA2.id, "/transactions")).set(headers);
      expect(ledger.status).toBe(200);
      expect(ledger.body.data.transactions.length).toBeGreaterThan(0);
      // eslint-disable-next-line no-await-in-loop
      const list = await request(app).get("/api/v1/inventory").set(headers);
      expect(list.status).toBe(200);
      expect(list.body.data.items.length).toBeGreaterThan(0);
    }
  });

  it("CUSTOMER reads stay forbidden", async () => {
    const headers = headersFor(ctx.customerA.id, ["CUSTOMER"]);
    expect((await request(app).get(invPath(ctx.productA.id, ctx.variantA2.id)).set(headers)).status).toBe(403);
    expect((await request(app).get(invPath(ctx.productA.id, ctx.variantA2.id, "/transactions")).set(headers)).status).toBe(403);
    expect((await request(app).get("/api/v1/inventory").set(headers)).status).toBe(403);
  });
});

describe("inventory tenant and suspension boundaries", () => {
  it("suspended-company mutations stay blocked for HEAD with state untouched", async () => {
    const headS = headersFor(ctx.headS.id, ["HEAD"]);
    const qtyBefore = await quantityOf(ctx.variantS1.id);
    for (const res of [
      await request(app).post(invPath(ctx.productS.id, ctx.variantS1.id)).set(headS).send({ quantity: 3 }),
      await request(app).patch(invPath(ctx.productS.id, ctx.variantS1.id)).set(headS).send({ quantity: 3 }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
    }
    expect(await quantityOf(ctx.variantS1.id)).toBe(qtyBefore);
  });

  it("foreign-company targets read as neutral 404 with nothing changed", async () => {
    for (const res of [
      await request(app).post(invPath(ctx.productB.id, ctx.variantB1.id)).set(headA()).send({ quantity: 3 }),
      await request(app).patch(invPath(ctx.productB.id, ctx.variantB1.id)).set(headA()).send({ quantity: 3 }),
      await request(app).get(invPath(ctx.productB.id, ctx.variantB1.id)).set(memberA()),
      await request(app).patch(invPath(ctx.productB.id, ctx.variantB1.id)).set(memberA()).send({ quantity: 3 }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
    }
    expect(await prisma.inventory.findUnique({ where: { variantId: ctx.variantB1.id } })).toBeNull();

    const ghost = "00000000-0000-0000-0000-000000000000";
    const unknown = await request(app).patch(invPath(ctx.productA.id, ghost)).set(headA()).send({ quantity: 1 });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ success: false, error: { code: "PRODUCT_VARIANT_NOT_FOUND", message: "Product variant not found" } });
  });

  it("body companyId smuggling is rejected; query/header companyId ignored", async () => {
    const smuggled = await request(app).post(invPath(ctx.productA.id, ctx.variantA1.id)).set(headA()).send({ quantity: 1, companyId: ctx.companyB.id });
    expect(smuggled.status).toBe(422);

    // variantA3 already initialized (qty 7) — adjust proves ignored tenancy.
    const qtyBefore = await quantityOf(ctx.variantA3.id);
    const scoped = await request(app).patch(`${invPath(ctx.productA.id, ctx.variantA3.id)}?companyId=${ctx.companyB.id}`).set({ ...headA(), "x-company-id": ctx.companyB.id }).send({ quantity: 1 });
    expect(scoped.status).toBe(200);
    expect(scoped.body.data.inventory.quantity).toBe(qtyBefore + 1);
  });
});

describe("inventory RBAC audit", () => {
  it("records HEAD/MEMBER actor snapshots with safe metadata", async () => {
    const events = await prisma.auditLog.findMany({
      where: { companyId: ctx.companyA.id, resource: "INVENTORY" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.length).toBeGreaterThan(0);
    const roles = new Set(events.map((event) => event.actorRole));
    expect(roles.has("HEAD")).toBe(true);
    expect(roles.has("MEMBER")).toBe(true);
    expect(roles.has("ADMIN")).toBe(true);
    for (const event of events) {
      expect(event.companyId).toBe(ctx.companyA.id);
      expect(["CREATED", "UPDATED"]).toContain(event.action);
      expect(event.outcome).toBe("SUCCESS");
      const serialized = JSON.stringify(event);
      for (const leaked of ["password", "secret", "token"]) {
        expect(serialized.toLowerCase()).not.toContain(leaked);
      }
    }
    const memberInit = events.find((event) => event.action === "CREATED" && event.actorRole === "MEMBER");
    expect(memberInit.details).toMatchObject({ quantity: 4 });
    const memberAdjust = events.find((event) => event.action === "UPDATED" && event.actorRole === "MEMBER");
    expect(memberAdjust.details).toMatchObject({ delta: 5, type: "RESTOCK" });
  });

  it("refused authorization and failed business rules emit no success audit", async () => {
    const before = await prisma.auditLog.count({ where: { resource: "INVENTORY" } });
    const refused = await request(app).patch(invPath(ctx.productA.id, ctx.variantA2.id)).set(headersFor(ctx.customerA.id, ["CUSTOMER"])).send({ quantity: 1 });
    expect(refused.status).toBe(403);
    const overdraw = await request(app).patch(invPath(ctx.productA.id, ctx.variantA2.id)).set(memberA()).send({ quantity: -1000 });
    expect(overdraw.status).toBe(409);
    expect(await prisma.auditLog.count({ where: { resource: "INVENTORY" } })).toBe(before);
  });
});
