import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-17 audit instrumentation: catalog, inventory, broadcasts,
 * coupons (live HTTP + MySQL).
 *
 * Every mutation below must leave exactly one AuditLog row with the
 * calling ADMIN's snapshot, the company scope, the business action,
 * the affected resource id, and safe metadata. Failed mutations must
 * leave no row. Company #1 is read-only; the dedicated company row
 * persists (catalog Restrict — repo convention) with its catalog
 * deactivated.
 */

const RUN = `TSTAI${Date.now().toString(36).toUpperCase()}`.toLowerCase();

const ctx = {};
const createdUserIds = [];

const headersFor = (id, roles = ["ADMIN"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function pngBuffer() {
  return sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 20, g: 140, b: 60 } } })
    .png()
    .toBuffer();
}

async function latestAudit(where) {
  return prisma.auditLog.findFirst({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

function expectAdminAudit(row, { action, resource, resourceId }) {
  expect(row).not.toBeNull();
  expect(row.actorId).toBe(ctx.admin.id);
  expect(row.actorRole).toBe("ADMIN");
  expect(row.actorEmail).toBe(ctx.adminEmail);
  expect(row.companyId).toBe(ctx.company.id);
  expect(row.action).toBe(action);
  expect(row.resource).toBe(resource);
  expect(row.resourceId).toBe(resourceId);
  expect(row.outcome).toBe("SUCCESS");
  expect(JSON.stringify(row)).not.toMatch(/password|otp|token|hash|secret|cookie|authorization/i);
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `${RUN}-co` } });
  ctx.company = company;
  ctx.adminEmail = `${RUN}-admin@example.test`;
  const admin = await provisionCompanyAdmin(company.id, {
    email: ctx.adminEmail,
    password: "TestPass123!",
    firstName: "AuditInst",
    lastName: "Admin",
  });
  createdUserIds.push(admin.id);
  ctx.admin = await prisma.user.findUnique({ where: { id: admin.id } });
  ctx.adminHeaders = headersFor(ctx.admin.id);
}, 120000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { companyId: ctx.company?.id } });
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (ctx.product) {
    await prisma.productVariant.updateMany({ where: { productId: ctx.product.id }, data: { isActive: false } });
    await prisma.product.updateMany({ where: { id: ctx.product.id }, data: { isActive: false } });
  }
  if (ctx.category) {
    await prisma.category.updateMany({ where: { id: ctx.category.id }, data: { isActive: false } });
  }
  await prisma.$disconnect();
});

describe("category audits", () => {
  it("create/update/deactivate/reactivate are recorded with the name", async () => {
    const created = await request(app)
      .post("/api/v1/categories")
      .set(ctx.adminHeaders)
      .send({ name: `${RUN} Cat` });
    expect(created.status).toBe(201);
    ctx.category = created.body.data.category;
    expectAdminAudit(await latestAudit({ resource: "CATEGORY", resourceId: ctx.category.id }), {
      action: "CREATED",
      resource: "CATEGORY",
      resourceId: ctx.category.id,
    });

    const updated = await request(app)
      .patch(`/api/v1/categories/${ctx.category.id}`)
      .set(ctx.adminHeaders)
      .send({ name: `${RUN} Cat Renamed` });
    expect(updated.status).toBe(200);
    const updateRow = await latestAudit({ resource: "CATEGORY", resourceId: ctx.category.id });
    expect(updateRow.action).toBe("UPDATED");
    expect(updateRow.details).toMatchObject({ name: `${RUN} Cat Renamed` });

    const deactivated = await request(app).delete(`/api/v1/categories/${ctx.category.id}`).set(ctx.adminHeaders);
    expect(deactivated.status).toBe(200);
    expect(
      (await latestAudit({ resource: "CATEGORY", resourceId: ctx.category.id })).action
    ).toBe("DEACTIVATED");

    const reactivated = await request(app)
      .patch(`/api/v1/categories/${ctx.category.id}`)
      .set(ctx.adminHeaders)
      .send({ isActive: true });
    expect(reactivated.status).toBe(200);
    expect(
      (await latestAudit({ resource: "CATEGORY", resourceId: ctx.category.id })).action
    ).toBe("REACTIVATED");
  });

  it("failed mutations record nothing", async () => {
    const before = await prisma.auditLog.count({ where: { companyId: ctx.company.id, resource: "CATEGORY" } });
    const ghost = "11111111-1111-1111-1111-111111111111";
    const res = await request(app).patch(`/api/v1/categories/${ghost}`).set(ctx.adminHeaders).send({ name: "Ghost" });
    expect(res.status).toBe(404);
    expect(await prisma.auditLog.count({ where: { companyId: ctx.company.id, resource: "CATEGORY" } })).toBe(before);
  });
});

describe("product and variant audits", () => {
  it("product create/update/deactivate/delete-confirm are recorded", async () => {
    const created = await request(app).post("/api/v1/products").set(ctx.adminHeaders).send({
      name: `${RUN} Widget`,
      categoryId: ctx.category.id,
      variants: [{ sku: `${RUN}-SKU-1`, name: "Standard", price: "99.99" }],
    });
    expect(created.status).toBe(201);
    ctx.product = created.body.data.product;
    ctx.variant = ctx.product.variants[0];
    expectAdminAudit(await latestAudit({ resource: "PRODUCT", resourceId: ctx.product.id }), {
      action: "CREATED",
      resource: "PRODUCT",
      resourceId: ctx.product.id,
    });

    const updated = await request(app)
      .patch(`/api/v1/products/${ctx.product.id}`)
      .set(ctx.adminHeaders)
      .send({ name: `${RUN} Widget v2` });
    expect(updated.status).toBe(200);
    expect((await latestAudit({ resource: "PRODUCT", resourceId: ctx.product.id })).action).toBe("UPDATED");

    const deactivated = await request(app)
      .patch(`/api/v1/products/${ctx.product.id}`)
      .set(ctx.adminHeaders)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect((await latestAudit({ resource: "PRODUCT", resourceId: ctx.product.id })).action).toBe("DEACTIVATED");

    const deleted = await request(app).delete(`/api/v1/products/${ctx.product.id}`).set(ctx.adminHeaders);
    expect(deleted.status).toBe(200);
    expect((await latestAudit({ resource: "PRODUCT", resourceId: ctx.product.id })).action).toBe("DELETED");
  });

  it("variant create/update/deactivate are recorded with the SKU", async () => {
    const created = await request(app)
      .post(`/api/v1/products/${ctx.product.id}/variants`)
      .set(ctx.adminHeaders)
      .send({ sku: `${RUN}-SKU-2`, name: "Deluxe", price: "149.99" });
    expect(created.status).toBe(201);
    const variant = created.body.data.variant;
    const createRow = await latestAudit({ resource: "PRODUCT_VARIANT", resourceId: variant.id });
    expectAdminAudit(createRow, { action: "CREATED", resource: "PRODUCT_VARIANT", resourceId: variant.id });
    expect(createRow.details).toMatchObject({ sku: `${RUN}-SKU-2` });

    const updated = await request(app)
      .patch(`/api/v1/products/${ctx.product.id}/variants/${variant.id}`)
      .set(ctx.adminHeaders)
      .send({ price: "159.99" });
    expect(updated.status).toBe(200);
    expect((await latestAudit({ resource: "PRODUCT_VARIANT", resourceId: variant.id })).action).toBe("UPDATED");

    const deactivated = await request(app)
      .delete(`/api/v1/products/${ctx.product.id}/variants/${variant.id}`)
      .set(ctx.adminHeaders);
    expect(deactivated.status).toBe(200);
    expect((await latestAudit({ resource: "PRODUCT_VARIANT", resourceId: variant.id })).action).toBe("DEACTIVATED");
  });
});

describe("product image audits", () => {
  it("upload/promote/remove are recorded against the owning product", async () => {
    const uploaded = await request(app)
      .post(`/api/v1/products/${ctx.product.id}/images`)
      .set(ctx.adminHeaders)
      .attach("image", await pngBuffer(), "img.png")
      .field("isPrimary", "true");
    expect(uploaded.status).toBe(201);
    const image = uploaded.body.data.image;
    const addRow = await latestAudit({ resource: "PRODUCT", resourceId: ctx.product.id });
    expectAdminAudit(addRow, { action: "UPDATED", resource: "PRODUCT", resourceId: ctx.product.id });
    expect(addRow.details).toMatchObject({ imageOperation: "added-primary", imageId: image.id });

    const meta = await request(app)
      .patch(`/api/v1/products/${ctx.product.id}/images/${image.id}`)
      .set(ctx.adminHeaders)
      .send({ sortOrder: 3 });
    expect(meta.status).toBe(200);
    expect((await latestAudit({ resource: "PRODUCT", resourceId: ctx.product.id })).details).toMatchObject({
      imageOperation: "metadata",
    });

    const removed = await request(app)
      .delete(`/api/v1/products/${ctx.product.id}/images/${image.id}`)
      .set(ctx.adminHeaders);
    expect(removed.status).toBe(200);
    expect((await latestAudit({ resource: "PRODUCT", resourceId: ctx.product.id })).details).toMatchObject({
      imageOperation: "removed",
      imageId: image.id,
    });
  });
});

describe("inventory audits", () => {
  it("initialize and adjustments are recorded with safe quantities", async () => {
    const initialized = await request(app)
      .post(`/api/v1/products/${ctx.product.id}/variants/${ctx.variant.id}/inventory`)
      .set(ctx.adminHeaders)
      .send({ quantity: 10 });
    expect(initialized.status).toBe(201);
    const record = initialized.body.data.inventory;
    const createRow = await latestAudit({ resource: "INVENTORY", resourceId: record.id });
    expectAdminAudit(createRow, { action: "CREATED", resource: "INVENTORY", resourceId: record.id });
    expect(createRow.details).toMatchObject({ quantity: 10 });

    const restocked = await request(app)
      .patch(`/api/v1/products/${ctx.product.id}/variants/${ctx.variant.id}/inventory`)
      .set(ctx.adminHeaders)
      .send({ quantity: 5 });
    expect(restocked.status).toBe(200);
    const restockRow = await latestAudit({ resource: "INVENTORY", resourceId: record.id });
    expect(restockRow.action).toBe("UPDATED");
    expect(restockRow.details).toMatchObject({ delta: 5, type: "RESTOCK" });

    const adjusted = await request(app)
      .patch(`/api/v1/products/${ctx.product.id}/variants/${ctx.variant.id}/inventory`)
      .set(ctx.adminHeaders)
      .send({ quantity: -2 });
    expect(adjusted.status).toBe(200);
    expect((await latestAudit({ resource: "INVENTORY", resourceId: record.id })).details).toMatchObject({
      delta: -2,
      type: "ADJUSTMENT",
    });
  });

  it("rejected adjustments record nothing", async () => {
    const record = await prisma.inventory.findUnique({ where: { variantId: ctx.variant.id } });
    const before = await prisma.auditLog.count({
      where: { companyId: ctx.company.id, resource: "INVENTORY", resourceId: record.id },
    });
    const res = await request(app)
      .patch(`/api/v1/products/${ctx.product.id}/variants/${ctx.variant.id}/inventory`)
      .set(ctx.adminHeaders)
      .send({ quantity: -999999 });
    expect(res.status).toBe(409);
    expect(
      await prisma.auditLog.count({
        where: { companyId: ctx.company.id, resource: "INVENTORY", resourceId: record.id },
      })
    ).toBe(before);
  });
});

describe("broadcast audits", () => {
  it("marketing create/update/delete are recorded with the title", async () => {
    const created = await request(app).post("/api/v1/marketing/notifications/admin").set(ctx.adminHeaders).send({
      title: `${RUN} Sale`,
      message: "Big savings this week",
    });
    expect(created.status).toBe(201);
    const item = created.body.data.notification;
    expectAdminAudit(await latestAudit({ resource: "MARKETING", resourceId: item.id }), {
      action: "CREATED",
      resource: "MARKETING",
      resourceId: item.id,
    });

    const updated = await request(app)
      .patch(`/api/v1/marketing/notifications/admin/${item.id}`)
      .set(ctx.adminHeaders)
      .send({ title: `${RUN} Sale Updated` });
    expect(updated.status).toBe(200);
    expect((await latestAudit({ resource: "MARKETING", resourceId: item.id })).action).toBe("UPDATED");

    const deleted = await request(app)
      .delete(`/api/v1/marketing/notifications/admin/${item.id}`)
      .set(ctx.adminHeaders);
    expect(deleted.status).toBe(200);
    expect((await latestAudit({ resource: "MARKETING", resourceId: item.id })).action).toBe("DELETED");
  });

  it("announcement create/update/delete are recorded", async () => {
    const created = await request(app).post("/api/v1/announcements/admin").set(ctx.adminHeaders).send({
      message: `${RUN} store notice`,
    });
    expect(created.status).toBe(201);
    const item = created.body.data.announcement;
    expectAdminAudit(await latestAudit({ resource: "ANNOUNCEMENT", resourceId: item.id }), {
      action: "CREATED",
      resource: "ANNOUNCEMENT",
      resourceId: item.id,
    });

    const updated = await request(app)
      .patch(`/api/v1/announcements/admin/${item.id}`)
      .set(ctx.adminHeaders)
      .send({ message: `${RUN} store notice v2` });
    expect(updated.status).toBe(200);
    expect((await latestAudit({ resource: "ANNOUNCEMENT", resourceId: item.id })).action).toBe("UPDATED");

    const deleted = await request(app).delete(`/api/v1/announcements/admin/${item.id}`).set(ctx.adminHeaders);
    expect(deleted.status).toBe(200);
    expect((await latestAudit({ resource: "ANNOUNCEMENT", resourceId: item.id })).action).toBe("DELETED");
  });
});

describe("coupon audits", () => {
  it("create/update/deactivate/delete are recorded without the code", async () => {
    const code = `${RUN}-10OFF`;
    const created = await request(app).post("/api/v1/coupons").set(ctx.adminHeaders).send({
      code,
      discountType: "PERCENTAGE",
      discountValue: "10.00",
    });
    expect(created.status).toBe(201);
    const coupon = created.body.data.coupon;
    const createRow = await latestAudit({ resource: "COUPON", resourceId: coupon.id });
    expectAdminAudit(createRow, { action: "CREATED", resource: "COUPON", resourceId: coupon.id });
    expect(JSON.stringify(createRow.details)).not.toContain(code);

    const updated = await request(app)
      .patch(`/api/v1/coupons/${coupon.id}`)
      .set(ctx.adminHeaders)
      .send({ discountValue: "15.00" });
    expect(updated.status).toBe(200);
    const updateRow = await latestAudit({ resource: "COUPON", resourceId: coupon.id });
    expect(updateRow.action).toBe("UPDATED");
    expect(updateRow.details).toMatchObject({ fields: expect.stringContaining("discountValue") });
    expect(JSON.stringify(updateRow)).not.toContain(code);

    const deactivated = await request(app)
      .patch(`/api/v1/coupons/${coupon.id}`)
      .set(ctx.adminHeaders)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect((await latestAudit({ resource: "COUPON", resourceId: coupon.id })).action).toBe("DEACTIVATED");

    const deleted = await request(app).delete(`/api/v1/coupons/${coupon.id}`).set(ctx.adminHeaders);
    expect(deleted.status).toBe(200);
    expect((await latestAudit({ resource: "COUPON", resourceId: coupon.id })).action).toBe("DELETED");
    // Domain history is untouched by the cross-resource trail.
    expect(await prisma.couponHistory.count({ where: { couponId: coupon.id } })).toBeGreaterThan(0);
  });
});
