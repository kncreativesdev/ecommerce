import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Phase 3-1 categories RBAC slice (live HTTP + MySQL).
 *
 * Wires the permissions.js category grants to the routes without
 * touching company scoping, suspension, validation, or audit:
 * - POST + PATCH → ADMIN/HEAD/MEMBER (MEMBER: no `isActive`, 403)
 * - DELETE (soft-deactivate) → ADMIN/HEAD (MEMBER: 403)
 * - image POST/DELETE → ADMIN/HEAD/MEMBER (category UPDATE mapping)
 * - reads stay public; inactive/all scopes stay ADMIN-only;
 *   SUPER_ADMIN/CUSTOMER stay excluded (403/401).
 *
 * Every boundary answers with the pre-existing codes — cross-company
 * and unmanageable targets read as the neutral 404 — and every
 * mutation keeps its actor/company-scoped audit event.
 */

const RUN = `TSTCR${Date.now().toString(36).toUpperCase()}`.toLowerCase();
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
      firstName: "Cat",
      lastName: tag,
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await ensureRole(roleName);
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function pngBuffer() {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .png()
    .toBuffer();
}

beforeAll(async () => {
  ctx.superAdmin = await createStaff("super", "SUPER_ADMIN", null);
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    // eslint-disable-next-line no-await-in-loop
    const company = await prisma.company.create({ data: { name: `${RUN} Cat Co ${tag}`, status } });
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
  ctx.memberB = await createStaff("member-b", "MEMBER", ctx.companyB.id);
  ctx.headS = await createStaff("head-s", "HEAD", ctx.companyS.id);
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

const catName = (tag) => `${RUN} ${tag}`;

describe("category create by role", () => {
  it("ADMIN creates company-stamped (isActive:false allowed, unchanged)", async () => {
    const res = await request(app).post("/api/v1/categories").set(adminA()).send({ name: catName("Admin Inactive"), isActive: false });
    expect(res.status).toBe(201);
    expect(res.body.data.category).toMatchObject({ name: catName("Admin Inactive"), isActive: false });
    const stored = await prisma.category.findUnique({ where: { id: res.body.data.category.id } });
    expect(stored.companyId).toBe(ctx.companyA.id);
  });

  it("HEAD creates company-stamped", async () => {
    const res = await request(app).post("/api/v1/categories").set(headA()).send({ name: catName("Head Made") });
    expect(res.status).toBe(201);
    expect(res.body.data.category).toMatchObject({ name: catName("Head Made"), isActive: true });
    ctx.headMadeId = res.body.data.category.id;
    const stored = await prisma.category.findUnique({ where: { id: ctx.headMadeId } });
    expect(stored.companyId).toBe(ctx.companyA.id);
  });

  it("MEMBER creates active; isActive:false is refused with nothing stored", async () => {
    const ok = await request(app).post("/api/v1/categories").set(memberA()).send({ name: catName("Member Made") });
    expect(ok.status).toBe(201);
    ctx.memberMadeId = ok.body.data.category.id;

    const refused = await request(app).post("/api/v1/categories").set(memberA()).send({ name: catName("Member Dark"), isActive: false });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("AUTH_FORBIDDEN");
    expect(await prisma.category.findFirst({ where: { name: catName("Member Dark") } })).toBeNull();
  });

  it("CUSTOMER, SUPER_ADMIN, and anonymous callers are refused", async () => {
    const customer = await request(app).post("/api/v1/categories").set(headersFor(ctx.customerA.id, ["CUSTOMER"])).send({ name: catName("Nope C") });
    expect(customer.status).toBe(403);
    const platform = await request(app).post("/api/v1/categories").set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"])).send({ name: catName("Nope S") });
    expect(platform.status).toBe(403);
    const anonymous = await request(app).post("/api/v1/categories").send({ name: catName("Nope A") });
    expect(anonymous.status).toBe(401);
    expect(await prisma.category.findFirst({ where: { name: { startsWith: `${RUN} nope` } } })).toBeNull();
  });

  it("body companyId smuggling is rejected; query companyId is ignored", async () => {
    const smuggled = await request(app).post("/api/v1/categories").set(headA()).send({ name: catName("Smuggled"), companyId: ctx.companyB.id });
    expect(smuggled.status).toBe(422);

    const scoped = await request(app).post(`/api/v1/categories?companyId=${ctx.companyB.id}`).set(headA()).send({ name: catName("Scoped") });
    expect(scoped.status).toBe(201);
    const stored = await prisma.category.findUnique({ where: { id: scoped.body.data.category.id } });
    expect(stored.companyId).toBe(ctx.companyA.id);
  });
});

describe("category update by role", () => {
  it("MEMBER updates fields but cannot touch isActive either way", async () => {
    const ok = await request(app).patch(`/api/v1/categories/${ctx.memberMadeId}`).set(memberA()).send({ description: "member edit" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.category.description).toBe("member edit");

    for (const isActive of [false, true]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).patch(`/api/v1/categories/${ctx.memberMadeId}`).set(memberA()).send({ isActive });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    }
    const stored = await prisma.category.findUnique({ where: { id: ctx.memberMadeId } });
    expect(stored).toMatchObject({ isActive: true, description: "member edit" });
  });

  it("HEAD flips isActive both ways; ADMIN behavior unchanged", async () => {
    const off = await request(app).patch(`/api/v1/categories/${ctx.headMadeId}`).set(headA()).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.category.isActive).toBe(false);
    const on = await request(app).patch(`/api/v1/categories/${ctx.headMadeId}`).set(headA()).send({ isActive: true });
    expect(on.status).toBe(200);
    expect(on.body.data.category.isActive).toBe(true);

    const adminFlip = await request(app).patch(`/api/v1/categories/${ctx.headMadeId}`).set(adminA()).send({ description: "admin edit", isActive: false });
    expect(adminFlip.status).toBe(200);
    expect(adminFlip.body.data.category).toMatchObject({ description: "admin edit", isActive: false });
    const back = await request(app).patch(`/api/v1/categories/${ctx.headMadeId}`).set(adminA()).send({ isActive: true });
    expect(back.status).toBe(200);
  });
});

describe("category deactivate by role", () => {
  it("HEAD soft-deactivates; MEMBER is refused with the row untouched", async () => {
    const created = await request(app).post("/api/v1/categories").set(headA()).send({ name: catName("Deactivate Me") });
    expect(created.status).toBe(201);
    const id = created.body.data.category.id;

    const memberAttempt = await request(app).delete(`/api/v1/categories/${id}`).set(memberA());
    expect(memberAttempt.status).toBe(403);
    expect((await prisma.category.findUnique({ where: { id } })).isActive).toBe(true);

    const headDelete = await request(app).delete(`/api/v1/categories/${id}`).set(headA());
    expect(headDelete.status).toBe(200);
    expect(headDelete.body.data.category.isActive).toBe(false);
    expect((await prisma.category.findUnique({ where: { id } })).isActive).toBe(false);
  });

  it("CUSTOMER delete stays forbidden", async () => {
    const res = await request(app).delete(`/api/v1/categories/${ctx.memberMadeId}`).set(headersFor(ctx.customerA.id, ["CUSTOMER"]));
    expect(res.status).toBe(403);
  });
});

describe("category tenant and suspension boundaries", () => {
  it("suspended-company mutations stay blocked for HEAD and MEMBER", async () => {
    const headS = headersFor(ctx.headS.id, ["HEAD"]);
    const res = await request(app).post("/api/v1/categories").set(headS).send({ name: catName("Suspended") });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
  });

  it("cross-company ids read as neutral 404 with nothing changed", async () => {
    const foreign = await prisma.category.create({
      data: { name: catName("Foreign"), slug: `${RUN}-foreign`, companyId: ctx.companyB.id },
    });
    for (const res of [
      await request(app).patch(`/api/v1/categories/${foreign.id}`).set(headA()).send({ description: "x" }),
      await request(app).delete(`/api/v1/categories/${foreign.id}`).set(headA()),
      await request(app).patch(`/api/v1/categories/${foreign.id}`).set(memberA()).send({ description: "x" }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("CATEGORY_NOT_FOUND");
    }
    expect((await prisma.category.findUnique({ where: { id: foreign.id } })).description).toBeNull();
    await prisma.category.delete({ where: { id: foreign.id } });
  });
});

describe("category images by role", () => {
  it("HEAD uploads and removes; MEMBER uploads and removes; CUSTOMER refused", async () => {
    const target = await request(app).post("/api/v1/categories").set(headA()).send({ name: catName("Imaged") });
    expect(target.status).toBe(201);
    const id = target.body.data.category.id;

    const headUpload = await request(app).post(`/api/v1/categories/${id}/image`).set(headA()).attach("image", await pngBuffer(), "img.png");
    expect(headUpload.status).toBe(200);
    expect(headUpload.body.data.category.image).toContain(`categories/${id}/`);
    const headRemove = await request(app).delete(`/api/v1/categories/${id}/image`).set(headA());
    expect(headRemove.status).toBe(200);
    expect(headRemove.body.data.category.image).toBeNull();

    const memberUpload = await request(app).post(`/api/v1/categories/${id}/image`).set(memberA()).attach("image", await pngBuffer(), "img.png");
    expect(memberUpload.status).toBe(200);
    expect(memberUpload.body.data.category.image).toContain(`categories/${id}/`);
    const memberRemove = await request(app).delete(`/api/v1/categories/${id}/image`).set(memberA());
    expect(memberRemove.status).toBe(200);

    const customerUpload = await request(app).post(`/api/v1/categories/${id}/image`).set(headersFor(ctx.customerA.id, ["CUSTOMER"])).attach("image", await pngBuffer(), "img.png");
    expect(customerUpload.status).toBe(403);
  });
});

describe("category RBAC audit", () => {
  it("records HEAD/MEMBER actor snapshots with safe metadata", async () => {
    const events = await prisma.auditLog.findMany({
      where: { companyId: ctx.companyA.id, resource: "CATEGORY" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.length).toBeGreaterThan(0);
    const roles = new Set(events.map((event) => event.actorRole));
    expect(roles.has("HEAD")).toBe(true);
    expect(roles.has("MEMBER")).toBe(true);
    expect(roles.has("ADMIN")).toBe(true);
    for (const event of events) {
      expect(event.companyId).toBe(ctx.companyA.id);
      expect(["CREATED", "UPDATED", "DEACTIVATED", "REACTIVATED"]).toContain(event.action);
      expect(event.outcome).toBe("SUCCESS");
      const serialized = JSON.stringify(event);
      for (const leaked of ["password", "secret", "token"]) {
        expect(serialized.toLowerCase()).not.toContain(leaked);
      }
    }
    const headCreated = events.find((event) => event.action === "CREATED" && event.actorRole === "HEAD");
    expect(headCreated.details).toMatchObject({ name: catName("Head Made") });
  });

  it("refused mutations emit no audit event", async () => {
    const before = await prisma.auditLog.count({ where: { resource: "CATEGORY" } });
    const refused = await request(app).post("/api/v1/categories").set(memberA()).send({ name: catName("Audit Dark"), isActive: false });
    expect(refused.status).toBe(403);
    const forbidden = await request(app).delete(`/api/v1/categories/${ctx.memberMadeId}`).set(memberA());
    expect(forbidden.status).toBe(403);
    expect(await prisma.auditLog.count({ where: { resource: "CATEGORY" } })).toBe(before);
  });
});
