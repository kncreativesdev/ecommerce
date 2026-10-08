import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionEmployee } from "../../src/modules/users/users.service.js";
import { UPLOADS_ROOT, localStorageAdapter } from "../../src/modules/media/storage/local.storage.js";
import { COMPANY_ONE_ID } from "../helpers/userFixtures.js";
import { runRetentionCleanup } from "../../src/modules/audit/retention.service.js";

/**
 * Phase 2C-20 permanent company deletion (live HTTP + MySQL).
 *
 * DELETE /api/v1/companies/:id is SUPER_ADMIN-only, SUSPENDED-only,
 * exact-name-confirmed, and Company #1 is protected by UUID. The
 * target company's full tenant graph is removed in one transaction
 * (per-table assertions below); global rows, SUPER_ADMINs, other
 * companies, and Company #1 are untouched; a platform DELETED audit
 * (companyId NULL) survives while company-scoped audit rows go.
 */

const RUN = `TSTCD${Date.now().toString(36).toUpperCase()}`.toLowerCase();

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];
const keepCompanyIds = [];

const headersFor = (id, roles) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createUser(tag, roleName, companyId, track = true) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Del",
      lastName: tag,
      phone: "9999999999",
      companyId,
    },
  });
  if (track) {
    createdUserIds.push(user.id);
  }
  let role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    role = await prisma.role.create({ data: { name: roleName } });
  }
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function pngBuffer() {
  return sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .png()
    .toBuffer();
}

const superHeaders = () => headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
const destroy = (id, body, headers = superHeaders()) =>
  request(app).delete(`/api/v1/companies/${id}`).set(headers).send(body);

beforeAll(async () => {
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);
  ctx.roleCount = await prisma.role.count();

  // Denied fixtures (legitimate ADMIN link, like the lifecycle suite).
  const denied = await prisma.company.create({ data: { name: `${RUN}-denied-co` } });
  createdCompanyIds.push(denied.id);
  for (const [tag, role] of [["admin", "ADMIN"], ["head", "HEAD"], ["member", "MEMBER"], ["customer", "CUSTOMER"]]) {
    ctx[tag] = await createUser(`denied-${tag}`, role, denied.id);
  }
  await prisma.company.update({ where: { id: denied.id }, data: { adminUserId: ctx.admin.id } });
  ctx.deniedCompany = denied;

  // Keep-company K with a small footprint (must survive T's deletion).
  const keep = await prisma.company.create({ data: { name: `${RUN}-keep-co` } });
  keepCompanyIds.push(keep.id);
  ctx.keepCompany = keep;
  ctx.keepAdmin = await createUser("keep-admin", "ADMIN", keep.id, false);
  await prisma.company.update({ where: { id: keep.id }, data: { adminUserId: ctx.keepAdmin.id } });
  ctx.keepCategory = await prisma.category.create({
    data: { name: `${RUN} Keep Cat`, slug: `${RUN}-keep-cat`, companyId: keep.id },
  });
  await prisma.companyDomain.create({ data: { companyId: keep.id, domain: `${RUN}-keep.example.test` } });

  // Target company T: created ACTIVE so data can be built as its ADMIN.
  const target = (
    await request(app).post("/api/v1/companies").set(superHeaders()).send({ name: `${RUN} Target Co` })
  ).body.data.company;
  ctx.target = target;
  const provisioned = await request(app)
    .post(`/api/v1/companies/${target.id}/admin`)
    .set(superHeaders())
    .send({ email: `${RUN}-target-admin@example.test`, password: "TestPass123!", firstName: "Target" });
  expect(provisioned.status).toBe(201);
  ctx.targetAdmin = provisioned.body.data.admin;
  const adminHeaders = headersFor(ctx.targetAdmin.id, ["ADMIN"]);

  await createUser("target-head", "HEAD", target.id, false);
  const headRow = await prisma.user.findFirst({ where: { email: `${RUN}-target-head@example.test` } });
  await provisionEmployee(
    { id: ctx.targetAdmin.id, companyId: target.id, roles: ["ADMIN"] },
    { email: `${RUN}-target-member@example.test`, password: "TestPass123!", firstName: "Target", lastName: "Member", role: "MEMBER" }
  );
  ctx.targetHead = headRow;
  ctx.targetMember = await prisma.user.findFirst({ where: { email: `${RUN}-target-member@example.test` } });
  ctx.targetCustomer = await createUser("target-customer", "CUSTOMER", target.id, false);

  const category = (
    await request(app).post("/api/v1/categories").set(adminHeaders).send({ name: `${RUN} Target Cat` })
  ).body.data.category;
  ctx.targetCategory = category;
  const product = (
    await request(app).post("/api/v1/products").set(adminHeaders).send({
      name: `${RUN} Target Widget`,
      categoryId: category.id,
      variants: [{ sku: `${RUN}-SKU-T`, name: "Standard", price: "80.00" }],
    })
  ).body.data.product;
  ctx.targetProduct = product;
  ctx.targetVariant = product.variants[0];

  const uploaded = await request(app)
    .post(`/api/v1/products/${product.id}/images`)
    .set(adminHeaders)
    .attach("image", await pngBuffer(), "img.png")
    .field("isPrimary", "true");
  expect(uploaded.status).toBe(201);
  ctx.targetImage = uploaded.body.data.image;

  const initialized = await request(app)
    .post(`/api/v1/products/${product.id}/variants/${ctx.targetVariant.id}/inventory`)
    .set(adminHeaders)
    .send({ quantity: 10 });
  expect(initialized.status).toBe(201);

  const coupon = (
    await request(app).post("/api/v1/coupons").set(adminHeaders).send({
      code: `${RUN}-5OFF`,
      discountType: "FIXED",
      discountValue: "5.00",
    })
  ).body.data.coupon;
  ctx.targetCoupon = coupon;
  await request(app).patch(`/api/v1/coupons/${coupon.id}`).set(adminHeaders).send({ description: "target coupon" });

  const marketing = (
    await request(app).post("/api/v1/marketing/notifications/admin").set(adminHeaders).send({
      title: `${RUN} Target Sale`,
      message: "Target savings",
    })
  ).body.data.notification;
  ctx.targetMarketing = marketing;
  const announcement = (
    await request(app).post("/api/v1/announcements/admin").set(adminHeaders).send({ message: `${RUN} target notice` })
  ).body.data.announcement;
  ctx.targetAnnouncement = announcement;

  // Customer order with coupon usage, driven to DELIVERED, returned,
  // and reviewed — the full order subgraph for the target company.
  const customerHeaders = headersFor(ctx.targetCustomer.id, ["CUSTOMER"]);
  const address = (
    await request(app).post("/api/v1/addresses").set(customerHeaders).send({
      fullName: "Target Customer",
      phone: "9999999999",
      addressLine1: "1 Target Road",
      city: "Target City",
      state: "Punjab",
      postalCode: "141002",
      country: "India",
    })
  ).body.data.address;
  await request(app)
    .post("/api/v1/cart/items")
    .set(customerHeaders)
    .send({ variantId: ctx.targetVariant.id, quantity: 1 });
  const order = (
    await request(app)
      .post("/api/v1/orders")
      .set(customerHeaders)
      .send({ shippingAddressId: address.id, couponCode: `${RUN}-5OFF` })
  ).body.data.order;
  ctx.targetOrder = order;
  for (const status of ["CONFIRMED", "PROCESSING", "DISPATCHED", "IN_TRANSIT", "ARRIVED_IN_CITY", "OUT_FOR_DELIVERY", "DELIVERED"]) {
    // eslint-disable-next-line no-await-in-loop
    await request(app).patch(`/api/v1/orders/admin/${order.id}/status`).set(adminHeaders).send({ status });
  }
  const orderDetail = (
    await request(app).get(`/api/v1/orders/${order.id}`).set(customerHeaders)
  ).body.data.order;
  const returnRequest = (
    await request(app).post(`/api/v1/orders/${order.id}/returns`).set(customerHeaders).send({ reason: "DAMAGED" })
  ).body.data.returnRequest;
  ctx.targetReturn = returnRequest;
  const review = (
    await request(app).post("/api/v1/reviews").set(customerHeaders).send({
      orderItemId: orderDetail.items[0].id,
      rating: 5,
      title: `${RUN} review`,
      comment: "Solid widget",
    })
  ).body.data.review;
  ctx.targetReview = review;

  await prisma.companyDomain.create({ data: { companyId: target.id, domain: `${RUN}-target.example.test` } });

  // Snapshot pre-delete identifiers for FK-free tables.
  ctx.targetUserIds = [ctx.targetAdmin.id, ctx.targetHead.id, ctx.targetMember.id, ctx.targetCustomer.id];
  ctx.targetOrderIds = [order.id];
  ctx.targetCouponIds = [coupon.id];
  ctx.targetVariantIds = [ctx.targetVariant.id];
  ctx.targetReturnIds = [returnRequest.id];
  ctx.targetImagePath = ctx.targetImage.storagePath;
  expect(await localStorageAdapter.exists(ctx.targetImagePath)).toBe(true);

  // Suspend the target: deletion requires SUSPENDED.
  const suspended = await request(app).post(`/api/v1/companies/${target.id}/suspend`).set(superHeaders());
  expect(suspended.status).toBe(200);
}, 180000);

afterAll(async () => {
  // Best-effort removal of auxiliary companies FIRST (the API path
  // writes platform audit rows, cleaned below); the keep-company and
  // Company #1 are never touched.
  for (const id of [...createdCompanyIds]) {
    try {
      const row = await prisma.company.findUnique({ where: { id } });
      if (row && row.status === "ACTIVE") {
        await request(app).post(`/api/v1/companies/${id}/suspend`).set(superHeaders());
      }
      const current = await prisma.company.findUnique({ where: { id } });
      if (current && current.id !== COMPANY_ONE_ID) {
        await request(app).delete(`/api/v1/companies/${id}`).set(superHeaders()).send({ confirmName: current.name });
      }
    } catch {
      // Best-effort test hygiene only.
    }
  }
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ companyId: { in: createdCompanyIds } }, { resourceId: { in: createdCompanyIds } }],
    },
  });
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.category.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await prisma.$disconnect();
});

describe("guard rails", () => {
  it("ACTIVE company cannot be deleted", async () => {
    const created = await request(app).post("/api/v1/companies").set(superHeaders()).send({ name: `${RUN} Active Co` });
    expect(created.status).toBe(201);
    const id = created.body.data.company.id;
    createdCompanyIds.push(id);
    const res = await destroy(id, { confirmName: `${RUN} Active Co` });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("COMPANY_NOT_SUSPENDED");
    expect((await prisma.company.findUnique({ where: { id } })).status).toBe("ACTIVE");
  });

  it("wrong and empty confirmations are rejected without writes", async () => {
    const id = ctx.target.id;
    for (const body of [{ confirmName: "Wrong Name" }, { confirmName: `${RUN} target co` }, { confirmName: "   " }, {}]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await destroy(id, body);
      expect(res.status).toBe(422);
    }
    expect((await prisma.company.findUnique({ where: { id } })).status).toBe("SUSPENDED");
  });

  it("Company #1 is protected by UUID, never by name", async () => {
    const exact = await destroy(COMPANY_ONE_ID, { confirmName: "Tech Pulse" });
    expect(exact.status).toBe(403);
    expect(exact.body.error.code).toBe("COMPANY_PROTECTED");
    const wrong = await destroy(COMPANY_ONE_ID, { confirmName: "Something Else" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("COMPANY_PROTECTED");
    expect((await prisma.company.findUnique({ where: { id: COMPANY_ONE_ID } })).status).toBe("ACTIVE");
  });

  it.each([["ADMIN", "admin"], ["HEAD", "head"], ["MEMBER", "member"], ["CUSTOMER", "customer"]])(
    "%s is rejected",
    async (_role, tag) => {
      const roles = { ADMIN: ["ADMIN"], HEAD: ["HEAD"], MEMBER: ["MEMBER"], CUSTOMER: ["CUSTOMER"] }[_role];
      const res = await destroy(ctx.target.id, { confirmName: `${RUN} Target Co` }, headersFor(ctx[tag].id, roles));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    }
  );

  it("anonymous is rejected", async () => {
    expect((await destroy(ctx.target.id, { confirmName: `${RUN} Target Co` }, {})).status).toBe(401);
  });

  it("force/delete flags and body companyId are rejected; query/header tricks are inert", async () => {
    const smuggled = await destroy(ctx.target.id, { confirmName: `${RUN} Target Co`, force: true });
    expect(smuggled.status).toBe(422);
    const withId = await destroy(ctx.target.id, { confirmName: `${RUN} Target Co`, companyId: ctx.keepCompany.id });
    expect(withId.status).toBe(422);
    expect(await prisma.company.findUnique({ where: { id: ctx.target.id } })).not.toBeNull();

    // Query/header company identifiers never steer the target: the
    // route id governs, so this deletes the smuggle company itself.
    const smuggle = await request(app).post("/api/v1/companies").set(superHeaders()).send({ name: `${RUN} Smuggle Co` });
    const smuggleId = smuggle.body.data.company.id;
    createdCompanyIds.push(smuggleId);
    await request(app).post(`/api/v1/companies/${smuggleId}/suspend`).set(superHeaders());
    const tricked = await request(app)
      .delete(`/api/v1/companies/${smuggleId}?companyId=${ctx.keepCompany.id}`)
      .set({ ...superHeaders(), "x-company-id": ctx.keepCompany.id })
      .send({ confirmName: `${RUN} Smuggle Co` });
    expect(tricked.status).toBe(200);
    expect(await prisma.company.findUnique({ where: { id: smuggleId } })).toBeNull();
    expect(await prisma.company.findUnique({ where: { id: ctx.keepCompany.id } })).not.toBeNull();
  });

  it("unknown companies 404", async () => {
    const res = await destroy("11111111-1111-1111-1111-111111111111", { confirmName: "Ghost Co" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("COMPANY_NOT_FOUND");
  });
});

describe("destructive deletion", () => {
  it("removes the whole tenant graph and answers with a minimal confirmation", async () => {
    const res = await destroy(ctx.target.id, { confirmName: `${RUN} Target Co` });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: { id: ctx.target.id, name: `${RUN} Target Co` } });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|orderNumber|refreshToken/i);

    expect(await prisma.company.findUnique({ where: { id: ctx.target.id } })).toBeNull();
    const byUsers = { userId: { in: ctx.targetUserIds } };
    const byCompanyUsers = { user: { companyId: ctx.target.id } };
    // Identity and customer-owned rows.
    expect(await prisma.user.count({ where: { id: { in: ctx.targetUserIds } } })).toBe(0);
    expect(await prisma.address.count({ where: byUsers })).toBe(0);
    expect(await prisma.cart.count({ where: byUsers })).toBe(0);
    expect(await prisma.wishlist.count({ where: byUsers })).toBe(0);
    expect(await prisma.notification.count({ where: byUsers })).toBe(0);
    // Catalog.
    expect(await prisma.category.count({ where: { companyId: ctx.target.id } })).toBe(0);
    expect(await prisma.product.count({ where: { companyId: ctx.target.id } })).toBe(0);
    expect(await prisma.productVariant.count({ where: { companyId: ctx.target.id } })).toBe(0);
    expect(await prisma.productImage.count({ where: { product: { companyId: ctx.target.id } } })).toBe(0);
    expect(await prisma.inventory.count({ where: { variantId: { in: ctx.targetVariantIds } } })).toBe(0);
    expect(await prisma.inventoryTransaction.count({ where: { variantId: { in: ctx.targetVariantIds } } })).toBe(0);
    // Orders and linked rows.
    expect(await prisma.order.count({ where: { id: { in: ctx.targetOrderIds } } })).toBe(0);
    expect(await prisma.orderItem.count({ where: { orderId: { in: ctx.targetOrderIds } } })).toBe(0);
    expect(await prisma.orderAddress.count({ where: { orderId: { in: ctx.targetOrderIds } } })).toBe(0);
    expect(await prisma.payment.count({ where: { orderId: { in: ctx.targetOrderIds } } })).toBe(0);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: { in: ctx.targetOrderIds } } })).toBe(0);
    expect(await prisma.returnRequest.count({ where: { id: { in: ctx.targetReturnIds } } })).toBe(0);
    expect(await prisma.returnRequestHistory.count({ where: { returnRequestId: { in: ctx.targetReturnIds } } })).toBe(0);
    expect(await prisma.review.count({ where: { userId: { in: ctx.targetUserIds } } })).toBe(0);
    // Coupons and linked rows (FK-free history asserted by id list).
    expect(await prisma.coupon.count({ where: { id: { in: ctx.targetCouponIds } } })).toBe(0);
    expect(await prisma.couponUsage.count({ where: { couponId: { in: ctx.targetCouponIds } } })).toBe(0);
    expect(await prisma.couponProduct.count({ where: { couponId: { in: ctx.targetCouponIds } } })).toBe(0);
    expect(await prisma.couponHistory.count({ where: { couponId: { in: ctx.targetCouponIds } } })).toBe(0);
    // Broadcasts, domains, company-scoped audits.
    expect(await prisma.marketingNotification.count({ where: { companyId: ctx.target.id } })).toBe(0);
    expect(await prisma.siteAnnouncement.count({ where: { companyId: ctx.target.id } })).toBe(0);
    expect(await prisma.companyDomain.count({ where: { companyId: ctx.target.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { companyId: ctx.target.id } })).toBe(0);
  });

  it("reclaims company media from the filesystem", async () => {
    expect(await localStorageAdapter.exists(ctx.targetImagePath)).toBe(false);
    await expect(fs.stat(path.join(UPLOADS_ROOT, "companies", ctx.target.id))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("leaves the surviving platform DELETED audit with safe metadata", async () => {
    const rows = await prisma.auditLog.findMany({
      where: { resource: "COMPANY", action: "DELETED", resourceId: ctx.target.id },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actorId).toBe(ctx.superAdmin.id);
    expect(row.actorRole).toBe("SUPER_ADMIN");
    expect(row.companyId).toBeNull();
    expect(row.outcome).toBe("SUCCESS");
    expect(row.details).toEqual({ companyId: ctx.target.id, companyName: `${RUN} Target Co` });
    expect(JSON.stringify(row)).not.toMatch(/password|otp|token|hash|secret|cookie|authorization/i);
  });

  it("repeated deletion safely reports not-found", async () => {
    const res = await destroy(ctx.target.id, { confirmName: `${RUN} Target Co` });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("COMPANY_NOT_FOUND");
  });
});

describe("blast-radius containment", () => {
  it("keeps other companies, global roles, SUPER_ADMINs, and Company #1 intact", async () => {
    expect(await prisma.company.findUnique({ where: { id: ctx.keepCompany.id } })).not.toBeNull();
    expect(await prisma.user.count({ where: { id: ctx.keepAdmin.id } })).toBe(1);
    expect(await prisma.category.count({ where: { id: ctx.keepCategory.id } })).toBe(1);
    expect(await prisma.companyDomain.count({ where: { companyId: ctx.keepCompany.id } })).toBe(1);
    expect(await prisma.role.count()).toBe(ctx.roleCount);
    expect(await prisma.user.count({ where: { id: ctx.superAdmin.id } })).toBe(1);
    expect(await prisma.company.findUnique({ where: { id: COMPANY_ONE_ID } })).not.toBeNull();
    expect(await prisma.user.count({ where: { companyId: COMPANY_ONE_ID } })).toBeGreaterThan(0);
  });

  it("restored companies refuse deletion (lifecycle guard)", async () => {
    const created = await request(app).post("/api/v1/companies").set(superHeaders()).send({ name: `${RUN} Raced Co` });
    const id = created.body.data.company.id;
    createdCompanyIds.push(id);
    await request(app).post(`/api/v1/companies/${id}/suspend`).set(superHeaders());
    await request(app).post(`/api/v1/companies/${id}/restore`).set(superHeaders());
    // State changed after suspension: deletion must refuse deterministically.
    const res = await destroy(id, { confirmName: `${RUN} Raced Co` });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("COMPANY_NOT_SUSPENDED");
    expect(await prisma.company.findUnique({ where: { id } })).not.toBeNull();
  });

  it("retention cleanup still works after a deletion", async () => {
    expect((await request(app).get("/api/v1/audit-retention").set(superHeaders())).status).toBe(200);
    // No global-policy assertions: the retention suite owns the global
    // policy and runs in parallel. What matters here is that cleanup
    // executes safely and preserves the fresh platform deletion audit.
    const result = await runRetentionCleanup();
    expect(typeof result.policy).toBe("string");
    expect(typeof result.deleted).toBe("number");
    expect(
      await prisma.auditLog.count({
        where: { resource: "COMPANY", action: "DELETED", resourceId: ctx.target.id },
      })
    ).toBe(1);
  });
});
