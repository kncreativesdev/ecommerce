import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin, provisionEmployee } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-7 notification + broadcast isolation (live HTTP + MySQL).
 *
 * Classification under test:
 * - Customer notifications: caller-owned (req.user.id is the only key);
 *   creation derives from order/user inside gated transactions.
 * - Marketing broadcasts: company-owned rows (new column), ADMIN CRUD
 *   scoped, viewer list scoped, link targets validated same-company.
 * - Announcements: company-owned for ADMIN management; the public
 *   /current read stays global by design until CompanyDomain runtime
 *   resolution (documented limitation — no client tenant selector).
 *
 * No recipient/read-state tables exist (no fan-out by design).
 * Cleanup: broadcasts deleted via API; cart lines removed.
 */

const RUN = `TSTNB${Date.now().toString(36).toUpperCase()}`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles = ["CUSTOMER"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN.toLowerCase()}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "NbIso",
      lastName: tag,
      phone: "9999999999",
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
      name: `${RUN} Contraption ${tag}`,
      slug: `${RUN.toLowerCase()}-prod-${tag}`,
      categoryId: category.id,
      companyId,
      isActive: true,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `${RUN}-${tag}`,
      name: `Variant ${tag}`,
      price: "60.00",
      isActive: true,
      companyId,
    },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, quantity: 10, reservedQuantity: 0 } });
  return { category, product, variant };
}

beforeAll(async () => {
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN.toLowerCase()}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "NbIso",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = admin;
  }
  const headA = await provisionEmployee(
    { id: ctx.adminA.id, companyId: ctx.companyA.id, roles: ["ADMIN"] },
    { email: `${RUN.toLowerCase()}-head-a@example.test`, password: "TestPass123!", firstName: "NbIso", lastName: "HeadA", role: "HEAD" }
  );
  createdUserIds.push(headA.id);
  ctx.headA = await prisma.user.findUnique({ where: { id: headA.id } });
  ctx.headA = await prisma.user.findUnique({ where: { id: headA.id } });

  ctx.catA = await createCatalog("a", ctx.companyA.id);
  ctx.catB = await createCatalog("b", ctx.companyB.id);
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.customerB = await createUser("customer-b", "CUSTOMER", ctx.companyB.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);

  // One order-driven notification per customer: place, then CONFIRM.
  for (const [tag, customerId, adminId, cat, addressHolder] of [
    ["A", ctx.customerA.id, ctx.adminA.id, ctx.catA, "addressA"],
    ["B", ctx.customerB.id, ctx.adminB.id, ctx.catB, "addressB"],
  ]) {
    const address = await request(app)
      .post("/api/v1/addresses")
      .set(headersFor(customerId))
      .send({
        fullName: "Nb Iso",
        phone: "9999999999",
        addressLine1: "2 Isolation Road",
        city: "Ludhiana",
        state: "Punjab",
        postalCode: "141002",
        country: "India",
      });
    expect(address.status).toBe(201);
    ctx[addressHolder] = address.body.data.address.id;
    await request(app).post("/api/v1/cart/items").set(headersFor(customerId)).send({
      variantId: cat.variant.id,
      quantity: 1,
    }).expect(200);
    const order = await request(app).post("/api/v1/orders").set(headersFor(customerId)).send({
      shippingAddressId: ctx[addressHolder],
    });
    expect(order.status).toBe(201);
    const step = await request(app)
      .patch(`/api/v1/orders/admin/${order.body.data.order.id}/status`)
      .set(headersFor(adminId, ["ADMIN"]))
      .send({ status: "CONFIRMED" });
    expect(step.status).toBe(200);
  }
  const listA = await request(app).get("/api/v1/notifications").set(headersFor(ctx.customerA.id));
  ctx.notificationA = listA.body.data.notifications[0];
  const listB = await request(app).get("/api/v1/notifications").set(headersFor(ctx.customerB.id));
  ctx.notificationB = listB.body.data.notifications[0];
  expect(ctx.notificationA?.id).toBeTruthy();
  expect(ctx.notificationB?.id).toBeTruthy();

  // One active broadcast + one announcement per company via ADMIN APIs.
  for (const [tag, adminId] of [["A", ctx.adminA.id], ["B", ctx.adminB.id]]) {
    const broadcast = await request(app)
      .post("/api/v1/marketing/notifications/admin")
      .set(headersFor(adminId, ["ADMIN"]))
      .send({ title: `${RUN} Deal ${tag}`, message: `Savings ${tag}`, type: "OFFER" });
    expect(broadcast.status).toBe(201);
    ctx[`broadcast${tag}`] = broadcast.body.data.notification;
    const announcement = await request(app)
      .post("/api/v1/announcements/admin")
      .set(headersFor(adminId, ["ADMIN"]))
      .send({ message: `${RUN} Top bar ${tag}`, priority: 1 });
    expect(announcement.status).toBe(201);
    ctx[`announcement${tag}`] = announcement.body.data.announcement;
  }

  // Phase 2C-26: public reads fail closed on unregistered hosts, so the
  // no-auth current-announcement assertion below resolves company A
  // through an explicit RUN-unique test domain (removed in afterAll)
  // instead of ambient localhost state.
  ctx.publicHost = `${RUN.toLowerCase()}-public.example.test`;
  const publicDomain = await prisma.companyDomain.create({
    data: { companyId: ctx.companyA.id, domain: ctx.publicHost, isPrimary: false, isActive: true },
  });
  ctx.publicDomainId = publicDomain.id;
}, 180000);

afterAll(async () => {
  if (ctx.publicDomainId) {
    await prisma.companyDomain.deleteMany({ where: { id: ctx.publicDomainId } });
  }
  for (const key of ["A", "B"]) {
    for (const b of [ctx[`broadcast${key}`]].filter(Boolean)) {
      try {
        await prisma.marketingNotification.deleteMany({ where: { id: b.id } });
      } catch { /* best-effort */ }
    }
    for (const a of [ctx[`announcement${key}`]].filter(Boolean)) {
      try {
        await prisma.siteAnnouncement.deleteMany({ where: { id: a.id } });
      } catch { /* best-effort */ }
    }
  }
  await prisma.cartItem.deleteMany({
    where: { cart: { userId: { in: [ctx.customerA?.id, ctx.customerB?.id].filter(Boolean) } } },
  });
  for (const cat of [ctx.catA, ctx.catB].filter(Boolean)) {
    await prisma.productVariant.updateMany({ where: { productId: cat.product.id }, data: { isActive: false } });
    await prisma.product.updateMany({ where: { id: cat.product.id }, data: { isActive: false } });
    await prisma.category.updateMany({ where: { id: cat.category.id }, data: { isActive: false } });
  }
  await prisma.$disconnect();
});

const adminA = () => headersFor(ctx.adminA.id, ["ADMIN"]);
const adminB = () => headersFor(ctx.adminB.id, ["ADMIN"]);

describe("customer notification isolation", () => {
  it("A lists only its own notifications", async () => {
    const res = await request(app).get("/api/v1/notifications").set(headersFor(ctx.customerA.id));
    expect(res.status).toBe(200);
    const ids = res.body.data.notifications.map((n) => n.id);
    expect(ids).toContain(ctx.notificationA.id);
    expect(ids).not.toContain(ctx.notificationB.id);
  });

  it("A cannot mark-read or delete B's notification", async () => {
    const mark = await request(app)
      .patch(`/api/v1/notifications/${ctx.notificationB.id}/read`)
      .set(headersFor(ctx.customerA.id));
    expect(mark.status).toBe(404);
    expect(mark.body.error.code).toBe("NOTIFICATION_NOT_FOUND");
    const del = await request(app)
      .delete(`/api/v1/notifications/${ctx.notificationB.id}`)
      .set(headersFor(ctx.customerA.id));
    expect(del.status).toBe(404);
    expect(await prisma.notification.findUnique({ where: { id: ctx.notificationB.id } })).not.toBeNull();
  });

  it("creation resolves through the gated order owner", async () => {
    const stored = await prisma.notification.findUnique({ where: { id: ctx.notificationA.id } });
    expect(stored.userId).toBe(ctx.customerA.id);
    const owner = await prisma.user.findUnique({ where: { id: stored.userId } });
    expect(owner.companyId).toBe(ctx.companyA.id);
  });
});

describe("marketing broadcast isolation", () => {
  it("A admin list excludes B broadcasts (stamped on create)", async () => {
    const stored = await prisma.marketingNotification.findUnique({ where: { id: ctx.broadcastA.id } });
    expect(stored.companyId).toBe(ctx.companyA.id);
    const res = await request(app).get("/api/v1/marketing/notifications/admin").set(adminA());
    expect(res.status).toBe(200);
    const ids = res.body.data.notifications.map((n) => n.id);
    expect(ids).toContain(ctx.broadcastA.id);
    expect(ids).not.toContain(ctx.broadcastB.id);
  });

  it("A admin cannot detail/mutate/deactivate B's broadcast", async () => {
    const detail = await request(app)
      .get(`/api/v1/marketing/notifications/admin/${ctx.broadcastB.id}`)
      .set(adminA());
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe("MARKETING_NOT_FOUND");
    expect(JSON.stringify(detail.body)).not.toContain(ctx.broadcastB.title);
    const patch = await request(app)
      .patch(`/api/v1/marketing/notifications/admin/${ctx.broadcastB.id}`)
      .set(adminA())
      .send({ title: "Hijacked" });
    expect(patch.status).toBe(404);
    const deactivate = await request(app)
      .patch(`/api/v1/marketing/notifications/admin/${ctx.broadcastB.id}`)
      .set(adminA())
      .send({ isActive: false });
    expect(deactivate.status).toBe(404);
    const del = await request(app)
      .delete(`/api/v1/marketing/notifications/admin/${ctx.broadcastB.id}`)
      .set(adminA());
    expect(del.status).toBe(404);
    const reread = await prisma.marketingNotification.findUnique({ where: { id: ctx.broadcastB.id } });
    expect(reread.title).toBe(ctx.broadcastB.title);
    expect(reread.isActive).toBe(true);
  });

  it("viewer list is company-scoped; link targets must be same-company", async () => {
    const active = await request(app)
      .get("/api/v1/marketing/notifications/active")
      .set(headersFor(ctx.customerA.id));
    expect(active.status).toBe(200);
    const ids = active.body.data.notifications.map((n) => n.id);
    expect(ids).toContain(ctx.broadcastA.id);
    expect(ids).not.toContain(ctx.broadcastB.id);
    const linked = await request(app)
      .post("/api/v1/marketing/notifications/admin")
      .set(adminA())
      .send({
        title: `${RUN} Smuggled`,
        message: "x",
        linkType: "PRODUCT",
        linkValue: ctx.catB.product.id,
      });
    expect(linked.status).toBe(404);
    expect(linked.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("HEAD and SUPER_ADMIN gain no broadcast authority", async () => {
    const head = await request(app)
      .get("/api/v1/marketing/notifications/admin")
      .set(headersFor(ctx.headA.id, ["HEAD"]));
    expect(head.status).toBe(403);
    expect(head.body.error.code).toBe("AUTH_FORBIDDEN");
    const sup = await request(app)
      .get("/api/v1/marketing/notifications/admin")
      .set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(sup.status).toBe(403);
  });
});

describe("announcement isolation and public limitation", () => {
  it("A admin manages only its own announcements", async () => {
    const stored = await prisma.siteAnnouncement.findUnique({ where: { id: ctx.announcementA.id } });
    expect(stored.companyId).toBe(ctx.companyA.id);
    const list = await request(app).get("/api/v1/announcements/admin").set(adminA());
    expect(list.status).toBe(200);
    const ids = list.body.data.announcements.map((a) => a.id);
    expect(ids).toContain(ctx.announcementA.id);
    expect(ids).not.toContain(ctx.announcementB.id);
    const detail = await request(app).get(`/api/v1/announcements/admin/${ctx.announcementB.id}`).set(adminA());
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe("ANNOUNCEMENT_NOT_FOUND");
    const patch = await request(app)
      .patch(`/api/v1/announcements/admin/${ctx.announcementB.id}`)
      .set(adminA())
      .send({ message: "Hijacked" });
    expect(patch.status).toBe(404);
    const del = await request(app)
      .delete(`/api/v1/announcements/admin/${ctx.announcementB.id}`)
      .set(adminA());
    expect(del.status).toBe(404);
    expect(await prisma.siteAnnouncement.findUnique({ where: { id: ctx.announcementB.id } })).not.toBeNull();
  });

  it("public current stays open with no tenant selector (documented limitation)", async () => {
    // No authentication, no companyId accepted: the endpoint resolves
    // the current row for the request's registered domain (runtime
    // resolution now scopes this per storefront).
    const res = await request(app).get("/api/v1/announcements/current").set("Host", ctx.publicHost);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect("announcement" in res.body.data).toBe(true);
  });

  it("SUPER_ADMIN cannot operate company announcements", async () => {
    const res = await request(app)
      .get("/api/v1/announcements/admin")
      .set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("suspended admin is rejected without creating broadcasts (Phase 2C-13)", async () => {
    const title = `${RUN} Susp Deal`;
    const res = await request(app)
      .post("/api/v1/marketing/notifications/admin")
      .set(headersFor(ctx.adminS.id, ["ADMIN"]))
      .send({ title, message: "S" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
    expect(await prisma.marketingNotification.findFirst({ where: { title } })).toBeNull();
  });
});
