import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Customer notification clearing (DELETE /notifications/:id, persisted).
 * - Success removes the row and updates unread counts.
 * - Ownership: customers can only clear their own notifications.
 * - Failure (missing/other-user) never pretends success.
 */

const RUN = `TSTNC${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = {
  categoryId: null,
  productId: null,
  variantId: null,
  customerAToken: null,
  customerBToken: null,
  addressId: null,
  notificationId: null,
};

const headersA = () => ({ Authorization: `Bearer ${ctx.customerAToken}` });
const headersB = () => ({ Authorization: `Bearer ${ctx.customerBToken}` });

async function register(email) {
  const registered = await request(app).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    firstName: "Notify",
    lastName: "Tester",
  });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  return loggedIn.body.data.accessToken;
}

beforeAll(async () => {
  const category = await request(app).post("/api/v1/categories").set(adminHeaders()).send({
    name: `${RUN} Category`,
  });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app).post("/api/v1/products").set(adminHeaders()).send({
    name: `${RUN} Widget`,
    categoryId: ctx.categoryId,
    variants: [{ sku: `${RUN}-SKU`, name: "Standard", price: "30.00" }],
  });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  ctx.variantId = product.body.data.product.variants[0].id;

  const inv = await request(app)
    .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variantId}/inventory`)
    .set(adminHeaders())
    .send({ quantity: 10 });
  expect(inv.status).toBe(201);

  ctx.customerAToken = await register(`${RUN.toLowerCase()}a@example.test`);
  ctx.customerBToken = await register(`${RUN.toLowerCase()}b@example.test`);

  const address = await request(app).post("/api/v1/addresses").set(headersA()).send({
    fullName: "Notify Tester",
    phone: "9999999999",
    addressLine1: "1 Test Street",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    country: "India",
  });
  expect(address.status).toBe(201);
  ctx.addressId = address.body.data.address.id;

  const added = await request(app).post("/api/v1/cart/items").set(headersA()).send({
    variantId: ctx.variantId,
    quantity: 1,
  });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(headersA()).send({
    shippingAddressId: ctx.addressId,
  });
  expect(order.status).toBe(201);
  const advance = await request(app)
    .patch(`/api/v1/orders/admin/${order.body.data.order.id}/status`)
    .set(adminHeaders())
    .send({ status: "CONFIRMED" });
  expect(advance.status).toBe(200);

  const list = await request(app).get("/api/v1/notifications").set(headersA());
  expect(list.status).toBe(200);
  expect(list.body.data.notifications.length).toBeGreaterThanOrEqual(1);
  ctx.notificationId = list.body.data.notifications[0].id;
}, 90000);

afterAll(async () => {
  try {
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("notification clearing", () => {
  it("rejects clearing another customer's notification (ownership)", async () => {
    const res = await request(app).delete(`/api/v1/notifications/${ctx.notificationId}`).set(headersB());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOTIFICATION_NOT_FOUND");
    // Owner still sees it (no silent removal).
    const ownerList = await request(app).get("/api/v1/notifications").set(headersA());
    expect(ownerList.body.data.notifications.some((n) => n.id === ctx.notificationId)).toBe(true);
  });

  it("clears the owner's notification persistently and updates unread counts", async () => {
    const before = await request(app).get("/api/v1/notifications/unread-count").set(headersA());
    expect(before.status).toBe(200);
    const beforeCount = before.body.data.unreadCount;

    const res = await request(app).delete(`/api/v1/notifications/${ctx.notificationId}`).set(headersA());
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ctx.notificationId);
    expect(typeof res.body.meta.unreadCount).toBe("number");

    const afterList = await request(app).get("/api/v1/notifications").set(headersA());
    expect(afterList.body.data.notifications.some((n) => n.id === ctx.notificationId)).toBe(false);
    const afterCount = await request(app).get("/api/v1/notifications/unread-count").set(headersA());
    expect(afterCount.body.data.unreadCount).toBeLessThanOrEqual(beforeCount);
  });

  it("returns 404 when clearing an already-cleared notification (no false success)", async () => {
    const res = await request(app).delete(`/api/v1/notifications/${ctx.notificationId}`).set(headersA());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOTIFICATION_NOT_FOUND");
  });
});
