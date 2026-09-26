import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Address book + order-snapshot integrity (live MySQL via supertest):
 *
 * - CRUD on /api/v1/addresses (list/create/get/update/delete)
 * - PATCH addressLine2 regression (was rejected by strict validation)
 * - single-default exclusivity (create/update with isDefault clears others)
 * - cross-user access → 404 ADDRESS_NOT_FOUND (never 403, never leaked)
 * - invalid payloads → 422
 * - order creation from a saved addressId snapshots the address; later
 *   edits/deletes of the book leave historical orders untouched
 * - another user's addressId at order time → 404 ORDER_ADDRESS_NOT_FOUND
 *
 * Dedicated TSTAD users/catalog; catalog rows deactivated afterwards.
 * Placed orders persist by design (immutable). No unrelated rows touched.
 */

const RUN = `TSTAD${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  userA: null,
  tokenA: null,
  userB: null,
  tokenB: null,
  addressId: null,
  secondId: null,
  categoryId: null,
  productId: null,
  variantId: null,
  orderId: null,
};

const ADDRESS_A = {
  label: "Home",
  fullName: "Jaskaran Singh",
  phone: "9876543210",
  addressLine1: "123 Model Town",
  addressLine2: "Near Clock Tower",
  city: "Ludhiana",
  state: "Punjab",
  postalCode: "141002",
  country: "India",
};

async function registerUser(suffix) {
  const email = `${RUN.toLowerCase()}-${suffix}@example.test`;
  const registered = await request(app)
    .post("/api/v1/auth/register")
    .send({ email, password: "TestPass123!", firstName: "Address", lastName: suffix });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  return { id: registered.body.data.user.id, token: loggedIn.body.data.accessToken };
}

const headersA = () => ({ Authorization: `Bearer ${ctx.tokenA}` });
const headersB = () => ({ Authorization: `Bearer ${ctx.tokenB}` });

beforeAll(async () => {
  const a = await registerUser("alpha");
  ctx.userA = a.id;
  ctx.tokenA = a.token;
  const b = await registerUser("beta");
  ctx.userB = b.id;
  ctx.tokenB = b.token;

  const category = await request(app)
    .post("/api/v1/categories")
    .set(adminHeaders())
    .send({ name: `${RUN} Category` });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app)
    .post("/api/v1/products")
    .set(adminHeaders())
    .send({
      name: `${RUN} Widget`,
      categoryId: ctx.categoryId,
      variants: [{ sku: `${RUN}-SKU1`, name: "Standard", price: "100.00" }],
    });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  ctx.variantId = product.body.data.product.variants[0].id;

  const inventory = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 50 });
  expect(inventory.status).toBe(201);
}, 60000);

afterAll(async () => {
  try {
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  try {
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  try {
    await prisma.address.deleteMany({ where: { userId: { in: [ctx.userA, ctx.userB].filter(Boolean) } } });
  } catch { /* best-effort: orders keep snapshots, book rows cleaned */ }
  await prisma.$disconnect();
});

describe("address CRUD", () => {
  it("creates an address with label + line2 + default flag", async () => {
    const res = await request(app)
      .post("/api/v1/addresses")
      .set(headersA())
      .send({ ...ADDRESS_A, isDefault: true });
    expect(res.status).toBe(201);
    expect(res.body.data.address).toMatchObject({
      label: "Home",
      fullName: "Jaskaran Singh",
      addressLine2: "Near Clock Tower",
      city: "Ludhiana",
      isDefault: true,
    });
    expect(res.body.data.address.userId).toBeUndefined();
    ctx.addressId = res.body.data.address.id;
  });

  it("lists own addresses default-first", async () => {
    const second = await request(app)
      .post("/api/v1/addresses")
      .set(headersA())
      .send({ ...ADDRESS_A, label: "Office", addressLine1: "456 Civil Lines" });
    expect(second.status).toBe(201);
    ctx.secondId = second.body.data.address.id;

    const list = await request(app).get("/api/v1/addresses").set(headersA());
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].isDefault).toBe(true);
  });

  it("retrieves a single own address", async () => {
    const res = await request(app).get(`/api/v1/addresses/${ctx.addressId}`).set(headersA());
    expect(res.status).toBe(200);
    expect(res.body.data.address.id).toBe(ctx.addressId);
  });

  it("rejects invalid payloads with 422", async () => {
    const res = await request(app)
      .post("/api/v1/addresses")
      .set(headersA())
      .send({ fullName: "No City", phone: "1", addressLine1: "x", country: "India" });
    expect(res.status).toBe(422);
  });
});

describe("default-address exclusivity", () => {
  it("promoting a second address demotes the first", async () => {
    const res = await request(app)
      .patch(`/api/v1/addresses/${ctx.secondId}`)
      .set(headersA())
      .send({ isDefault: true });
    expect(res.status).toBe(200);
    expect(res.body.data.address.isDefault).toBe(true);

    const first = await request(app).get(`/api/v1/addresses/${ctx.addressId}`).set(headersA());
    expect(first.body.data.address.isDefault).toBe(false);
  });
});

describe("update addressLine2 regression", () => {
  it("PATCH carrying addressLine2 succeeds (was 422 under strict validation)", async () => {
    const res = await request(app)
      .patch(`/api/v1/addresses/${ctx.secondId}`)
      .set(headersA())
      .send({ addressLine2: "Second Floor" });
    expect(res.status).toBe(200);
    expect(res.body.data.address.addressLine2).toBe("Second Floor");
  });

  it("empty PATCH is rejected without touching the row", async () => {
    const res = await request(app).patch(`/api/v1/addresses/${ctx.secondId}`).set(headersA()).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ADDRESS_UPDATE_INVALID");
  });
});

describe("cross-user ownership", () => {
  it("another user's address is invisible (get/patch/delete → 404)", async () => {
    const get = await request(app).get(`/api/v1/addresses/${ctx.addressId}`).set(headersB());
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe("ADDRESS_NOT_FOUND");

    const patch = await request(app)
      .patch(`/api/v1/addresses/${ctx.addressId}`)
      .set(headersB())
      .send({ city: "Hijacked" });
    expect(patch.status).toBe(404);

    const del = await request(app).delete(`/api/v1/addresses/${ctx.addressId}`).set(headersB());
    expect(del.status).toBe(404);
  });

  it("user B sees an empty book (no leakage)", async () => {
    const list = await request(app).get("/api/v1/addresses").set(headersB());
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });

  it("ordering with another user's addressId is rejected", async () => {
    const res = await request(app)
      .post("/api/v1/orders")
      .set(headersB())
      .send({ shippingAddressId: ctx.addressId });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_ADDRESS_NOT_FOUND");
  });
});

describe("order snapshot integrity", () => {
  it("places an order from the saved address and snapshots it", async () => {
    const added = await request(app)
      .post("/api/v1/cart/items")
      .set(headersA())
      .send({ variantId: ctx.variantId, quantity: 1 });
    expect(added.status).toBe(200);

    const order = await request(app)
      .post("/api/v1/orders")
      .set(headersA())
      .send({ shippingAddressId: ctx.secondId });
    expect(order.status).toBe(201);
    ctx.orderId = order.body.data.order.id;
    const shipping = order.body.data.order.addresses.find((a) => a.type === "SHIPPING");
    expect(shipping).toMatchObject({
      fullName: "Jaskaran Singh",
      addressLine1: "456 Civil Lines",
      addressLine2: "Second Floor",
      city: "Ludhiana",
    });
  });

  it("editing the saved address leaves the historical order untouched", async () => {
    const edited = await request(app)
      .patch(`/api/v1/addresses/${ctx.secondId}`)
      .set(headersA())
      .send({ addressLine1: "789 New Road", city: "Amritsar" });
    expect(edited.status).toBe(200);

    const order = await request(app).get(`/api/v1/orders/${ctx.orderId}`).set(headersA());
    expect(order.status).toBe(200);
    const shipping = order.body.data.order.addresses.find((a) => a.type === "SHIPPING");
    expect(shipping.addressLine1).toBe("456 Civil Lines");
    expect(shipping.city).toBe("Ludhiana");
  });

  it("deleting the saved address leaves the historical order untouched", async () => {
    const del = await request(app).delete(`/api/v1/addresses/${ctx.secondId}`).set(headersA());
    expect(del.status).toBe(200);

    const order = await request(app).get(`/api/v1/orders/${ctx.orderId}`).set(headersA());
    expect(order.status).toBe(200);
    const shipping = order.body.data.order.addresses.find((a) => a.type === "SHIPPING");
    expect(shipping.addressLine1).toBe("456 Civil Lines");

    const list = await request(app).get("/api/v1/addresses").set(headersA());
    expect(list.body.data.some((a) => a.id === ctx.secondId)).toBe(false);
  });
});
