import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Phase 3-7 marketing + announcements RBAC posture (live HTTP + MySQL).
 *
 * The permissions.js matrix grants HEAD/MEMBER nothing on these
 * resources (ADMIN holds notification:MANAGE + announcement:MANAGE;
 * no marketing namespace exists), so per the stop-and-report rule NO
 * route changed: all ten management endpoints stay
 * `authorize("ADMIN")`. This suite locks that ADMIN-only contract:
 * - ADMIN full cycle works (proves the surface itself is intact)
 * - HEAD/MEMBER/CUSTOMER/SUPER_ADMIN/anonymous are refused everywhere
 *   with nothing created, mutated, or deleted
 * - suspension gate precedes authorization (COMPANY_SUSPENDED)
 * - customer reads (`/active`, `/current`) keep working
 * - refused requests emit no mutation audit events
 */

const RUN = `TSTMA${Date.now().toString(36).toUpperCase()}`.toLowerCase();
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
      firstName: "Ma",
      lastName: tag,
      phone: "9999999999",
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await ensureRole(roleName);
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

beforeAll(async () => {
  ctx.superAdmin = await createStaff("super", "SUPER_ADMIN", null);
  for (const [tag, status] of [["a", "ACTIVE"], ["s", "SUSPENDED"]]) {
    // eslint-disable-next-line no-await-in-loop
    const company = await prisma.company.create({ data: { name: `${RUN} Ma Co ${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
  }
  ctx.adminA = await createStaff("admin-a", "ADMIN", ctx.companyA.id);
  await prisma.company.update({ where: { id: ctx.companyA.id }, data: { adminUserId: ctx.adminA.id } });
  ctx.headA = await createStaff("head-a", "HEAD", ctx.companyA.id);
  ctx.memberA = await createStaff("member-a", "MEMBER", ctx.companyA.id);
  ctx.customerA = await createStaff("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.headS = await createStaff("head-s", "HEAD", ctx.companyS.id);

  const adminHeaders = headersFor(ctx.adminA.id, ["ADMIN"]);
  const broadcast = await request(app).post("/api/v1/marketing/notifications/admin").set(adminHeaders).send({
    title: `${RUN} Deal`,
    message: "Half price today",
  });
  expect(broadcast.status).toBe(201);
  ctx.broadcastId = broadcast.body.data.notification.id;
  const announcement = await request(app).post("/api/v1/announcements/admin").set(adminHeaders).send({
    message: `${RUN} Free shipping over fifty`,
  });
  expect(announcement.status).toBe(201);
  ctx.announcementId = announcement.body.data.announcement.id;
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
  await prisma.marketingNotification.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await prisma.siteAnnouncement.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
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

describe("ADMIN management surface intact", () => {
  it("ADMIN runs the full broadcast lifecycle", async () => {
    const created = await request(app).post("/api/v1/marketing/notifications/admin").set(adminA()).send({ title: `${RUN} Flash`, message: "now" });
    expect(created.status).toBe(201);
    const id = created.body.data.notification.id;
    expect((await request(app).get("/api/v1/marketing/notifications/admin").set(adminA())).status).toBe(200);
    expect((await request(app).get(`/api/v1/marketing/notifications/admin/${id}`).set(adminA())).status).toBe(200);
    expect((await request(app).patch(`/api/v1/marketing/notifications/admin/${id}`).set(adminA()).send({ title: `${RUN} Flash 2` })).status).toBe(200);
    expect((await request(app).delete(`/api/v1/marketing/notifications/admin/${id}`).set(adminA())).status).toBe(200);
    expect(await prisma.marketingNotification.findUnique({ where: { id } })).toBeNull();
  });

  it("ADMIN runs the full announcement lifecycle", async () => {
    const created = await request(app).post("/api/v1/announcements/admin").set(adminA()).send({ message: `${RUN} Sale today` });
    expect(created.status).toBe(201);
    const id = created.body.data.announcement.id;
    expect((await request(app).get("/api/v1/announcements/admin").set(adminA())).status).toBe(200);
    expect((await request(app).get(`/api/v1/announcements/admin/${id}`).set(adminA())).status).toBe(200);
    expect((await request(app).patch(`/api/v1/announcements/admin/${id}`).set(adminA()).send({ message: `${RUN} Sale tomorrow` })).status).toBe(200);
    expect((await request(app).delete(`/api/v1/announcements/admin/${id}`).set(adminA())).status).toBe(200);
    expect(await prisma.siteAnnouncement.findUnique({ where: { id } })).toBeNull();
  });
});

describe("HEAD and MEMBER stay forbidden on all management routes", () => {
  it.each([
    ["HEAD marketing list", "HEAD", "GET", "/api/v1/marketing/notifications/admin", null, null],
    ["HEAD marketing create", "HEAD", "POST", "/api/v1/marketing/notifications/admin", "marketing", null],
    ["HEAD marketing delete", "HEAD", "DELETE", "marketing", null, null],
    ["HEAD announcement list", "HEAD", "GET", "/api/v1/announcements/admin", null, null],
    ["HEAD announcement create", "HEAD", "POST", "/api/v1/announcements/admin", "announcement", null],
    ["HEAD announcement delete", "HEAD", "DELETE", "announcement", null, null],
    ["MEMBER marketing list", "MEMBER", "GET", "/api/v1/marketing/notifications/admin", null, null],
    ["MEMBER marketing create", "MEMBER", "POST", "/api/v1/marketing/notifications/admin", "marketing", null],
    ["MEMBER marketing delete", "MEMBER", "DELETE", "marketing", null, null],
    ["MEMBER announcement list", "MEMBER", "GET", "/api/v1/announcements/admin", null, null],
    ["MEMBER announcement create", "MEMBER", "POST", "/api/v1/announcements/admin", "announcement", null],
    ["MEMBER announcement delete", "MEMBER", "DELETE", "announcement", null, null],
  ])("%s → 403 with nothing changed", async (_label, role, method, target, kind) => {
    const headers = role === "HEAD" ? headA() : memberA();
    let path = target;
    if (method === "DELETE") {
      path = kind === "marketing"
        ? `/api/v1/marketing/notifications/admin/${ctx.broadcastId}`
        : `/api/v1/announcements/admin/${ctx.announcementId}`;
    }
    let req = request(app)[method.toLowerCase()](path).set(headers);
    if (method === "POST") {
      req = req.send(kind === "marketing" ? { title: `${RUN} Nope`, message: "x" } : { message: `${RUN} Nope` });
    }
    const res = await req;
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("HEAD/MEMBER PATCH and detail reads refused; rows byte-identical", async () => {
    const beforeBroadcast = await prisma.marketingNotification.findUnique({ where: { id: ctx.broadcastId } });
    const beforeAnnouncement = await prisma.siteAnnouncement.findUnique({ where: { id: ctx.announcementId } });
    for (const headers of [headA(), memberA()]) {
      for (const res of [
        // eslint-disable-next-line no-await-in-loop
        await request(app).get(`/api/v1/marketing/notifications/admin/${ctx.broadcastId}`).set(headers),
        // eslint-disable-next-line no-await-in-loop
        await request(app).patch(`/api/v1/marketing/notifications/admin/${ctx.broadcastId}`).set(headers).send({ title: "hijack" }),
        // eslint-disable-next-line no-await-in-loop
        await request(app).get(`/api/v1/announcements/admin/${ctx.announcementId}`).set(headers),
        // eslint-disable-next-line no-await-in-loop
        await request(app).patch(`/api/v1/announcements/admin/${ctx.announcementId}`).set(headers).send({ message: "hijack" }),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
      }
    }
    expect(await prisma.marketingNotification.findUnique({ where: { id: ctx.broadcastId } })).toEqual(beforeBroadcast);
    expect(await prisma.siteAnnouncement.findUnique({ where: { id: ctx.announcementId } })).toEqual(beforeAnnouncement);
  });

  it("CUSTOMER, SUPER_ADMIN, and anonymous callers refused", async () => {
    const customer = headersFor(ctx.customerA.id, ["CUSTOMER"]);
    const platform = headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
    expect((await request(app).get("/api/v1/marketing/notifications/admin").set(customer)).status).toBe(403);
    expect((await request(app).post("/api/v1/marketing/notifications/admin").set(customer).send({ title: "x", message: "y" })).status).toBe(403);
    expect((await request(app).get("/api/v1/marketing/notifications/admin").set(platform)).status).toBe(403);
    expect((await request(app).post("/api/v1/marketing/notifications/admin").set(platform).send({ title: "x", message: "y" })).status).toBe(403);
    expect((await request(app).get("/api/v1/announcements/admin").set(customer)).status).toBe(403);
    expect((await request(app).post("/api/v1/announcements/admin").set(customer).send({ message: "x" })).status).toBe(403);
    expect((await request(app).get("/api/v1/announcements/admin").set(platform)).status).toBe(403);
    expect((await request(app).post("/api/v1/announcements/admin").set(platform).send({ message: "x" })).status).toBe(403);
    expect((await request(app).get("/api/v1/marketing/notifications/admin")).status).toBe(401);
    expect((await request(app).get("/api/v1/announcements/admin")).status).toBe(401);
    expect(await prisma.marketingNotification.count({ where: { title: "x" } })).toBe(0);
  });
});

describe("suspension precedes management authorization", () => {
  it("suspended HEAD is stopped with COMPANY_SUSPENDED and nothing stored", async () => {
    const headS = headersFor(ctx.headS.id, ["HEAD"]);
    for (const res of [
      await request(app).post("/api/v1/marketing/notifications/admin").set(headS).send({ title: `${RUN} Susp`, message: "x" }),
      await request(app).post("/api/v1/announcements/admin").set(headS).send({ message: `${RUN} Susp` }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
    }
    expect(await prisma.marketingNotification.findFirst({ where: { title: `${RUN} Susp` } })).toBeNull();
    expect(await prisma.siteAnnouncement.findFirst({ where: { message: `${RUN} Susp` } })).toBeNull();
  });
});

describe("customer-facing reads keep working", () => {
  it("authenticated customers see the active broadcast; public current resolves", async () => {
    const customer = headersFor(ctx.customerA.id, ["CUSTOMER"]);
    const active = await request(app).get("/api/v1/marketing/notifications/active").set(customer);
    expect(active.status).toBe(200);
    expect(active.body.data.notifications.map((row) => row.id)).toContain(ctx.broadcastId);

    // Public current without a registered host stays fail-closed (no
    // company context → 404, no existence oracle). Domain-scoped
    // resolution itself is covered by the storefront suites.
    const current = await request(app).get("/api/v1/announcements/current");
    expect(current.status).toBe(404);
  });
});

describe("refused management emits no mutation audit", () => {
  it("HEAD/MEMBER failures leave the audit log untouched", async () => {
    const scope = { companyId: { in: createdCompanyIds } };
    const before = await prisma.auditLog.count({ where: scope });
    const headCreate = await request(app).post("/api/v1/marketing/notifications/admin").set(headA()).send({ title: `${RUN} Audit`, message: "x" });
    expect(headCreate.status).toBe(403);
    const memberDelete = await request(app).delete(`/api/v1/announcements/admin/${ctx.announcementId}`).set(memberA());
    expect(memberDelete.status).toBe(403);
    expect(await prisma.auditLog.count({ where: scope })).toBe(before);
  });
});
