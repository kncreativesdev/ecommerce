import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Product-level single-primary invariant (live MySQL):
 * PATCH /products/:productId/images/:imageId { isPrimary: true } promotes
 * the target and demotes every other image of the SAME product atomically.
 * Variant-scoped and legacy (variantId null) rows are handled identically;
 * other products are never touched.
 */

const RUN = `TSTPI${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  otherProductId: null,
  variantA: null,
  variantB: null,
  otherVariant: null,
  imageA1: null,
  imageA2: null,
  imageB1: null,
  imageP1: null,
  otherImage: null,
};

async function pngBuffer() {
  return sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 20, g: 140, b: 60 } } })
    .png()
    .toBuffer();
}

async function uploadImage(productId, buffer, meta = {}) {
  const req = request(app).post(`/api/v1/products/${productId}/images`).set(adminHeaders());
  req.attach("image", buffer, { filename: "test.png", contentType: "image/png" });
  for (const [key, value] of Object.entries(meta)) {
    req.field(key, String(value));
  }
  return req;
}

async function listImages(productId) {
  const res = await request(app).get(`/api/v1/products/${productId}/images`);
  expect(res.status).toBe(200);
  return res.body.data;
}

beforeAll(async () => {
  const category = await request(app).post("/api/v1/categories").set(adminHeaders()).send({
    name: `${RUN} Category`,
  });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app).post("/api/v1/products").set(adminHeaders()).send({
    name: `${RUN} Shirt`,
    categoryId: ctx.categoryId,
    variants: [
      { sku: `${RUN}-A`, name: "Alpha", price: "100.00" },
      { sku: `${RUN}-B`, name: "Beta", price: "120.00" },
    ],
  });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  const bySku = Object.fromEntries(product.body.data.product.variants.map((v) => [v.sku, v]));
  ctx.variantA = bySku[`${RUN}-A`];
  ctx.variantB = bySku[`${RUN}-B`];

  const other = await request(app).post("/api/v1/products").set(adminHeaders()).send({
    name: `${RUN} Other`,
    categoryId: ctx.categoryId,
    variants: [{ sku: `${RUN}-OTHER`, name: "Other", price: "50.00" }],
  });
  expect(other.status).toBe(201);
  ctx.otherProductId = other.body.data.product.id;
  ctx.otherVariant = other.body.data.product.variants[0];

  // Seed with two primaries on purpose (legacy-style): A2 + P1 both primary.
  const a1 = await uploadImage(ctx.productId, await pngBuffer(), { variantId: ctx.variantA.id, sortOrder: 0 });
  expect(a1.status).toBe(201);
  ctx.imageA1 = a1.body.data.image;
  const a2 = await uploadImage(ctx.productId, await pngBuffer(), {
    variantId: ctx.variantA.id,
    sortOrder: 1,
    isPrimary: "true",
  });
  expect(a2.status).toBe(201);
  ctx.imageA2 = a2.body.data.image;
  const b1 = await uploadImage(ctx.productId, await pngBuffer(), { variantId: ctx.variantB.id, sortOrder: 0 });
  expect(b1.status).toBe(201);
  ctx.imageB1 = b1.body.data.image;
  const p1 = await uploadImage(ctx.productId, await pngBuffer(), { isPrimary: "true" });
  expect(p1.status).toBe(201);
  ctx.imageP1 = p1.body.data.image;

  const otherImg = await uploadImage(ctx.otherProductId, await pngBuffer(), { isPrimary: "true" });
  expect(otherImg.status).toBe(201);
  ctx.otherImage = otherImg.body.data.image;
}, 90000);

afterAll(async () => {
  try {
    for (const imageId of [ctx.imageA1?.id, ctx.imageA2?.id, ctx.imageB1?.id, ctx.imageP1?.id].filter(Boolean)) {
      const current = await listImages(ctx.productId).catch(() => []);
      if (current.some((img) => img.id === imageId)) {
        await request(app).delete(`/api/v1/products/${ctx.productId}/images/${imageId}`).set(adminHeaders());
      }
    }
    if (ctx.otherImage?.id) {
      await request(app).delete(`/api/v1/products/${ctx.otherProductId}/images/${ctx.otherImage.id}`).set(adminHeaders());
    }
  } catch { /* best-effort */ }
  try {
    await request(app).patch(`/api/v1/products/${ctx.productId}`).set(adminHeaders()).send({ isActive: false });
    await request(app).patch(`/api/v1/products/${ctx.otherProductId}`).set(adminHeaders()).send({ isActive: false });
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/products/${ctx.otherProductId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("set primary enforces single product-level primary", () => {
  it("promotes a non-primary image and demotes every sibling", async () => {
    const res = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/images/${ctx.imageB1.id}`)
      .set(adminHeaders())
      .send({ isPrimary: true });
    expect(res.status).toBe(200);
    expect(res.body.data.image).toMatchObject({ id: ctx.imageB1.id, isPrimary: true });

    const images = await listImages(ctx.productId);
    const primaries = images.filter((img) => img.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toBe(ctx.imageB1.id);

    const byId = Object.fromEntries(images.map((img) => [img.id, img]));
    expect(byId[ctx.imageA2.id].isPrimary).toBe(false);
    expect(byId[ctx.imageP1.id].isPrimary).toBe(false);
    expect(byId[ctx.imageA1.id].isPrimary).toBe(false);
  });

  it("switching primary to a legacy product-level image demotes variant images", async () => {
    const res = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/images/${ctx.imageP1.id}`)
      .set(adminHeaders())
      .send({ isPrimary: true });
    expect(res.status).toBe(200);
    expect(res.body.data.image.isPrimary).toBe(true);

    const images = await listImages(ctx.productId);
    expect(images.filter((img) => img.isPrimary).map((img) => img.id)).toEqual([ctx.imageP1.id]);
  });

  it("switching primary back to a variant image keeps legacy rows non-primary", async () => {
    const res = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/images/${ctx.imageA1.id}`)
      .set(adminHeaders())
      .send({ isPrimary: true });
    expect(res.status).toBe(200);

    const images = await listImages(ctx.productId);
    expect(images.filter((img) => img.isPrimary).map((img) => img.id)).toEqual([ctx.imageA1.id]);
  });

  it("leaves other products untouched", async () => {
    const before = await listImages(ctx.otherProductId);
    expect(before.filter((img) => img.isPrimary).map((img) => img.id)).toEqual([ctx.otherImage.id]);

    await request(app)
      .patch(`/api/v1/products/${ctx.productId}/images/${ctx.imageB1.id}`)
      .set(adminHeaders())
      .send({ isPrimary: true })
      .expect(200);

    const after = await listImages(ctx.otherProductId);
    expect(after.filter((img) => img.isPrimary).map((img) => img.id)).toEqual([ctx.otherImage.id]);
  });

  it("rejects a nonexistent image", async () => {
    const res = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/images/00000000-0000-0000-0000-000000000000`)
      .set(adminHeaders())
      .send({ isPrimary: true });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEDIA_NOT_FOUND");
  });

  it("rejects an image belonging to another product (mismatched ids)", async () => {
    const before = await listImages(ctx.productId);
    const beforePrimaries = before.filter((img) => img.isPrimary).map((img) => img.id);

    const res = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/images/${ctx.otherImage.id}`)
      .set(adminHeaders())
      .send({ isPrimary: true });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEDIA_NOT_FOUND");

    const after = await listImages(ctx.productId);
    expect(after.filter((img) => img.isPrimary).map((img) => img.id)).toEqual(beforePrimaries);
    const otherAfter = await listImages(ctx.otherProductId);
    expect(otherAfter.filter((img) => img.isPrimary).map((img) => img.id)).toEqual([ctx.otherImage.id]);
  });

  it("exposes exactly one primary in the list serialization for card consumption", async () => {
    await request(app)
      .patch(`/api/v1/products/${ctx.productId}/images/${ctx.imageA2.id}`)
      .set(adminHeaders())
      .send({ isPrimary: true })
      .expect(200);
    const images = await listImages(ctx.productId);
    const primaries = images.filter((img) => img.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toMatchObject({
      id: ctx.imageA2.id,
      productId: ctx.productId,
      variantId: ctx.variantA.id,
    });
    expect(typeof primaries[0].storagePath).toBe("string");
  });

  it("does not partially update on validation failure", async () => {
    await request(app)
      .patch(`/api/v1/products/${ctx.productId}/images/${ctx.imageB1.id}`)
      .set(adminHeaders())
      .send({ isPrimary: true })
      .expect(200);
    const before = await listImages(ctx.productId);
    const beforePrimaries = before.filter((img) => img.isPrimary).map((img) => img.id);

    const bad = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/images/${ctx.imageA1.id}`)
      .set(adminHeaders())
      .send({});
    expect(bad.status).toBe(422);

    const after = await listImages(ctx.productId);
    expect(after.filter((img) => img.isPrimary).map((img) => img.id)).toEqual(beforePrimaries);
  });

  it("uploading a new primary demotes existing primaries atomically", async () => {
    const uploaded = await uploadImage(ctx.productId, await pngBuffer(), {
      variantId: ctx.variantB.id,
      isPrimary: "true",
    });
    expect(uploaded.status).toBe(201);
    const newId = uploaded.body.data.image.id;
    expect(uploaded.body.data.image.isPrimary).toBe(true);

    const images = await listImages(ctx.productId);
    expect(images.filter((img) => img.isPrimary).map((img) => img.id)).toEqual([newId]);

    await request(app).delete(`/api/v1/products/${ctx.productId}/images/${newId}`).set(adminHeaders()).expect(200);
    // Restore a deterministic primary for subsequent suites.
    await request(app)
      .patch(`/api/v1/products/${ctx.productId}/images/${ctx.imageA2.id}`)
      .set(adminHeaders())
      .send({ isPrimary: true })
      .expect(200);
  });
});
