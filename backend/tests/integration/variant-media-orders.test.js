import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Variant-media lifecycle + order image snapshots (live MySQL):
 * - variant-scoped upload auth/scoping/validation
 * - multiple images per variant, primary/sort ordering
 * - checkout snapshots the purchased variant's display image
 * - snapshots survive media replacement and variant deactivation
 * - cart lines and wishlist briefs expose variant display data
 * - imageless variants snapshot null (legacy-compatible)
 *
 * Test catalog rows are DEACTIVATED afterwards (no hard-delete endpoints
 * by design); uploaded files are removed through the real DELETE media
 * endpoint where possible.
 */

const RUN = `TSTVM${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  customerToken: null,
  addressId: null,
  productId: null,
  variantA: null,
  variantB: null,
  variantPlain: null,
  otherVariant: null,
  imageA1: null,
  imageA2: null,
  imageB1: null,
  imageP1: null,
  orderId: null,
};

async function pngBuffer() {
  return sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 10, g: 120, b: 200 } } })
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

beforeAll(async () => {
  const category = await request(app).post("/api/v1/categories").set(adminHeaders()).send({
    name: `${RUN} Category`,
  });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app)
    .post("/api/v1/products")
    .set(adminHeaders())
    .send({
      name: `${RUN} Shirt`,
      categoryId: ctx.categoryId,
      variants: [
        { sku: `${RUN}-BLACK`, name: "Black", price: "100.00" },
        { sku: `${RUN}-BLUE`, name: "Blue", price: "120.00" },
        { sku: `${RUN}-PLAIN`, name: "Plain", price: "90.00" },
      ],
    });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  const bySku = Object.fromEntries(product.body.data.product.variants.map((v) => [v.sku, v]));
  ctx.variantA = bySku[`${RUN}-BLACK`];
  ctx.variantB = bySku[`${RUN}-BLUE`];
  ctx.variantPlain = bySku[`${RUN}-PLAIN`];

  for (const variant of [ctx.variantA, ctx.variantB, ctx.variantPlain]) {
    const inventory = await request(app)
      .post(`/api/v1/products/${ctx.productId}/variants/${variant.id}/inventory`)
      .set(adminHeaders())
      .send({ quantity: 20 });
    expect(inventory.status).toBe(201);
  }

  const other = await request(app).post("/api/v1/products").set(adminHeaders()).send({
    name: `${RUN} Other`,
    categoryId: ctx.categoryId,
    variants: [{ sku: `${RUN}-OTHER`, name: "Other", price: "50.00" }],
  });
  expect(other.status).toBe(201);
  ctx.otherProductId = other.body.data.product.id;
  ctx.otherVariant = other.body.data.product.variants[0];

  // Variant A: two images (second flagged primary). Variant B: one.
  // Product level: one primary fallback image.
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
  const b1 = await uploadImage(ctx.productId, await pngBuffer(), { variantId: ctx.variantB.id });
  expect(b1.status).toBe(201);
  ctx.imageB1 = b1.body.data.image;
  const p1 = await uploadImage(ctx.productId, await pngBuffer(), { isPrimary: "true" });
  expect(p1.status).toBe(201);
  ctx.imageP1 = p1.body.data.image;

  const email = `${RUN.toLowerCase()}@example.test`;
  const registered = await request(app
  ).post("/api/v1/auth/register")
    .send({ email, password: "TestPass123!", firstName: "Variant", lastName: "Tester" });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  ctx.customerToken = loggedIn.body.data.accessToken;

  const address = await request(app)
    .post("/api/v1/addresses")
    .set({ Authorization: `Bearer ${ctx.customerToken}` })
    .send({
      fullName: "Variant Tester",
      phone: "9999999999",
      addressLine1: "1 Test Street",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
    });
  expect(address.status).toBe(201);
  ctx.addressId = address.body.data.address.id;
}, 90000);

afterAll(async () => {
  try {
    for (const imageId of [ctx.imageA1?.id, ctx.imageA2?.id, ctx.imageB1?.id, ctx.imageP1?.id]) {
      if (imageId) {
        await request(app).delete(`/api/v1/products/${ctx.productId}/images/${imageId}`).set(adminHeaders());
      }
    }
  } catch { /* best-effort */ }
  try {
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/products/${ctx.otherProductId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });

describe("variant media authorization and scoping", () => {
  it("rejects anonymous and customer-role uploads", async () => {
    const anonymous = await request(app)
      .post(`/api/v1/products/${ctx.productId}/images`)
      .attach("image", await pngBuffer(), { filename: "test.png", contentType: "image/png" });
    expect(anonymous.status).toBe(401);

    const req = request(app).post(`/api/v1/products/${ctx.productId}/images`).set(customerHeaders());
    req.attach("image", await pngBuffer(), { filename: "test.png", contentType: "image/png" });
    const customer = await req;
    expect(customer.status).toBe(403);
  });

  it("rejects unknown variants and cross-product variants", async () => {
    const unknown = await uploadImage(ctx.productId, await pngBuffer(), {
      variantId: "00000000-0000-0000-0000-000000000000",
    });
    expect(unknown.status).toBe(404);

    const crossProduct = await uploadImage(ctx.productId, await pngBuffer(), { variantId: ctx.otherVariant.id });
    expect(crossProduct.status).toBe(404);
    expect(crossProduct.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
  });

  it("lists variant-scoped images publicly in deterministic order", async () => {
    const res = await request(app).get(`/api/v1/products/${ctx.productId}/images`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
    const forA = res.body.data.filter((image) => image.variantId === ctx.variantA.id);
    expect(forA).toHaveLength(2);
    // sortOrder ascending: non-primary first, primary second.
    expect(forA[0].id).toBe(ctx.imageA1.id);
    expect(forA[1].id).toBe(ctx.imageA2.id);
    expect(forA[1].isPrimary).toBe(true);
    const productLevel = res.body.data.filter((image) => image.variantId === null);
    expect(productLevel).toHaveLength(1);
  });
});

describe("variant display data in cart and wishlist", () => {
  it("exposes the purchased variant's display image on cart lines", async () => {
    const added = await request(app).post("/api/v1/cart/items").set(customerHeaders()).send({
      variantId: ctx.variantA.id,
      quantity: 1,
    });
    expect(added.status).toBe(200);
    const line = added.body.data.cart.items.find((item) => item.variantId === ctx.variantA.id);
    expect(line.variant.sku).toBe(`${RUN}-BLACK`);
    // Variant A primary image wins over the product-level primary.
    expect(line.image).toMatchObject({ storagePath: ctx.imageA2.storagePath });

    const addedPlain = await request(app).post("/api/v1/cart/items").set(customerHeaders()).send({
      variantId: ctx.variantPlain.id,
      quantity: 1,
    });
    expect(addedPlain.status).toBe(200);
    const plainLine = addedPlain.body.data.cart.items.find((item) => item.variantId === ctx.variantPlain.id);
    // Imageless variant falls back to the product-level primary image.
    expect(plainLine.image).toMatchObject({ storagePath: ctx.imageP1.storagePath });
  });

  it("carries default-variant display data on wishlist briefs without persisting variants", async () => {
    const added = await request(app).post("/api/v1/wishlist/items").set(customerHeaders()).send({
      productId: ctx.productId,
    });
    expect(added.status).toBe(200);
    const item = added.body.data.wishlist.items.find((entry) => entry.productId === ctx.productId);
    expect(item.product.variants).toHaveLength(3);
    expect(item.product.variants[0]).toMatchObject({ name: "Black", sku: `${RUN}-BLACK` });
  });
});

describe("order image snapshots", () => {
  it("snapshots each purchased variant's display image at order time", async () => {
    const addedB = await request(app).post("/api/v1/cart/items").set(customerHeaders()).send({
      variantId: ctx.variantB.id,
      quantity: 1,
    });
    expect(addedB.status).toBe(200);
    const res = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
    });
    expect(res.status).toBe(201);
    ctx.orderId = res.body.data.order.id;
    const bySku = Object.fromEntries(res.body.data.order.items.map((item) => [item.sku, item]));
    // Variant A primary, variant B single, plain variant product fallback.
    expect(bySku[`${RUN}-BLACK`].imageStoragePath).toBe(ctx.imageA2.storagePath);
    expect(bySku[`${RUN}-BLUE`].imageStoragePath).toBe(ctx.imageB1.storagePath);
    expect(bySku[`${RUN}-PLAIN`].imageStoragePath).toBe(ctx.imageP1.storagePath);
    expect(bySku[`${RUN}-BLACK`].variantName).toBe("Black");
  });

  it("keeps the snapshot stable after media replacement and variant deactivation", async () => {
    const removed = await request(app)
      .delete(`/api/v1/products/${ctx.productId}/images/${ctx.imageA2.id}`)
      .set(adminHeaders());
    expect(removed.status).toBe(200);
    const replacement = await uploadImage(ctx.productId, await pngBuffer(), {
      variantId: ctx.variantA.id,
      isPrimary: "true",
    });
    expect(replacement.status).toBe(201);
    expect(replacement.body.data.image.storagePath).not.toBe(ctx.imageA2.storagePath);

    const deactivated = await request(app)
      .delete(`/api/v1/products/${ctx.productId}/variants/${ctx.variantA.id}`)
      .set(adminHeaders());
    expect(deactivated.status).toBe(200);

    const order = await request(app).get(`/api/v1/orders/${ctx.orderId}`).set(customerHeaders());
    expect(order.status).toBe(200);
    const black = order.body.data.order.items.find((item) => item.sku === `${RUN}-BLACK`);
    // Historical snapshot untouched by the replacement and the deactivation.
    expect(black.imageStoragePath).toBe(ctx.imageA2.storagePath);
    expect(black.variantName).toBe("Black");
    expect(black.unitPrice).toBe("100.00");

    const adminOrder = await request(app).get(`/api/v1/orders/admin/${ctx.orderId}`).set(adminHeaders());
    expect(adminOrder.status).toBe(200);
    expect(
      adminOrder.body.data.order.items.find((item) => item.sku === `${RUN}-BLACK`).imageStoragePath
    ).toBe(ctx.imageA2.storagePath);

    // Deactivation preserves media metadata (records stay listed under the
    // still-active product); only variant deletion nulls the link.
    const gallery = await request(app).get(`/api/v1/products/${ctx.productId}/images`);
    expect(gallery.status).toBe(200);
    expect(gallery.body.data.some((image) => image.variantId === ctx.variantA.id)).toBe(true);
  });
});
