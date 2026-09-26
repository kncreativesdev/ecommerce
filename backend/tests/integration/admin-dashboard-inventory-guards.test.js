import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

/**
 * Dashboard/inventory guards + adjustment/order integrity (live MySQL).
 *
 * Complements `admin-dashboard-inventory.test.js` (which owns revenue
 * semantics, frames, and the main inventory flows). This suite owns:
 * - validation responses (422) for bad range / list / adjustment input,
 * - unknown-param stripping,
 * - unknown-variant 404s and ADMIN-only enforcement on mutations,
 * - pagination metadata consistency (meta vs page length),
 * - manual-adjustment integrity: adjustments never rewrite order
 *   snapshots and never fabricate ORDER ledger rows.
 *
 * Unique RUN identifiers; catalog rows are deactivated afterwards.
 */

const RUN = `TSTDG${Date.now().toString(36).toUpperCase()}`;
const adminHeaders = () => ({ Authorization: `Bearer ${signAccessToken({ id: "admin-test", roles: ["ADMIN"] })}` });

const ctx = { categoryId: null, productId: null, variants: {}, customerToken: null, addressId: null };

const customerHeaders = () => ({ Authorization: `Bearer ${ctx.customerToken}` });

beforeAll(async () => {
  const category = await request(app).post("/api/v1/categories").set(adminHeaders()).send({
    name: `${RUN} Category`,
  });
  expect(category.status).toBe(201);
  ctx.categoryId = category.body.data.category.id;

  const product = await request(app).post("/api/v1/products").set(adminHeaders()).send({
    name: `${RUN} Widget`,
    categoryId: ctx.categoryId,
    variants: [
      { sku: `${RUN}-G1`, name: "Guard One", price: "500.00" },
      { sku: `${RUN}-G2`, name: "Guard Two", price: "700.00" },
    ],
  });
  expect(product.status).toBe(201);
  ctx.productId = product.body.data.product.id;
  for (const variant of product.body.data.product.variants) {
    ctx.variants[variant.sku.replace(`${RUN}-`, "")] = variant;
  }

  for (const sku of ["G1", "G2"]) {
    const res = await request(app)
      .post(`/api/v1/products/${ctx.productId}/variants/${ctx.variants[sku].id}/inventory`)
      .set(adminHeaders())
      .send({ quantity: 5 });
    expect(res.status).toBe(201);
  }

  const email = `${RUN.toLowerCase()}@example.test`;
  const registered = await request(app).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    firstName: "Guard",
    lastName: "Tester",
  });
  expect(registered.status).toBe(201);
  const loggedIn = await request(app).post("/api/v1/auth/login").send({ email, password: "TestPass123!" });
  expect(loggedIn.status).toBe(200);
  ctx.customerToken = loggedIn.body.data.accessToken;

  const address = await request(app).post("/api/v1/addresses").set(customerHeaders()).send({
    fullName: "Guard Tester",
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
    await request(app).delete(`/api/v1/products/${ctx.productId}`).set(adminHeaders());
    await request(app).delete(`/api/v1/categories/${ctx.categoryId}`).set(adminHeaders());
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("dashboard summary validation", () => {
  it("rejects an unknown range with 422 and defaults a missing range to today", async () => {
    const bad = await request(app).get("/api/v1/dashboard/summary?range=bogus").set(adminHeaders());
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");

    const missing = await request(app).get("/api/v1/dashboard/summary").set(adminHeaders());
    expect(missing.status).toBe(200);
    expect(missing.body.data.summary.range).toBe("today");
  });

  it("strips unknown query params instead of rejecting the dashboard", async () => {
    const res = await request(app).get("/api/v1/dashboard/summary?range=today&foo=bar").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.summary.range).toBe("today");
  });
});

describe("admin inventory list validation and pagination", () => {
  it("rejects invalid stock, page, limit, and sort values with 422", async () => {
    for (const query of ["stock=low", "page=0", "limit=200", "sortBy=bogus", "sortOrder=sideways", "active=maybe"]) {
      const res = await request(app).get(`/api/v1/inventory?${query}`).set(adminHeaders());
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("strips unknown list params instead of rejecting", async () => {
    const res = await request(app).get("/api/v1/inventory?foo=bar").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it("keeps pagination metadata consistent with (not equal to) page length", async () => {
    const res = await request(app).get("/api/v1/inventory?limit=1&page=1").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 1 });
    expect(res.body.meta.total).toBeGreaterThanOrEqual(res.body.data.items.length);
    expect(res.body.meta.totalPages).toBe(Math.max(1, Math.ceil(res.body.meta.total / res.body.meta.limit)));
  });
});

describe("inventory mutation guards", () => {
  const patchUrl = () => `/api/v1/products/${ctx.productId}/variants/${ctx.variants.G2.id}/inventory`;

  it("rejects zero, mistyped, and missing deltas with 422", async () => {
    for (const body of [{ quantity: 0 }, { quantity: "5" }, { quantity: 1.5 }, {}]) {
      const res = await request(app).patch(patchUrl()).set(adminHeaders()).send(body);
      expect(res.status).toBe(422);
    }
  });

  it("rejects unknown variants and non-admin access", async () => {
    const missing = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/variants/00000000-0000-0000-0000-000000000000/inventory`)
      .set(adminHeaders())
      .send({ quantity: 1 });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");

    const anonymous = await request(app).patch(patchUrl()).send({ quantity: 1 });
    expect(anonymous.status).toBe(401);

    const customer = await request(app).patch(patchUrl()).set(customerHeaders()).send({ quantity: 1 });
    expect(customer.status).toBe(403);
  });

  it("rejects duplicate initialization with 409", async () => {
    const res = await request(app).post(patchUrl()).set(adminHeaders()).send({ quantity: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVENTORY_ALREADY_EXISTS");
  });
});

describe("manual adjustments never touch orders", () => {
  it("leaves order snapshots and ORDER ledger rows unchanged", async () => {
    const added = await request(app).post("/api/v1/cart/items").set(customerHeaders()).send({
      variantId: ctx.variants.G1.id,
      quantity: 1,
    });
    expect(added.status).toBe(200);
    const created = await request(app).post("/api/v1/orders").set(customerHeaders()).send({
      shippingAddressId: ctx.addressId,
    });
    expect(created.status).toBe(201);
    const orderId = created.body.data.order.id;
    const grandTotalBefore = created.body.data.order.grandTotal;

    const adjusted = await request(app)
      .patch(`/api/v1/products/${ctx.productId}/variants/${ctx.variants.G1.id}/inventory`)
      .set(adminHeaders())
      .send({ quantity: 2, note: "Guard adjustment" });
    expect(adjusted.status).toBe(200);

    // The historical order snapshot is immutable.
    const detail = await request(app).get(`/api/v1/orders/admin/${orderId}`).set(adminHeaders());
    expect(detail.status).toBe(200);
    expect(detail.body.data.order.grandTotal).toBe(grandTotalBefore);

    // The ledger gains exactly one ADMIN adjustment row — never a second
    // ORDER row for the same order id.
    const ledger = await request(app)
      .get(`/api/v1/products/${ctx.productId}/variants/${ctx.variants.G1.id}/inventory/transactions?limit=100`)
      .set(adminHeaders());
    expect(ledger.status).toBe(200);
    const orderRows = ledger.body.data.transactions.filter(
      (t) => t.type === "ORDER" && t.referenceId === orderId
    );
    expect(orderRows).toHaveLength(1);
    const manualRows = ledger.body.data.transactions.filter(
      (t) => t.note === "Guard adjustment"
    );
    expect(manualRows).toHaveLength(1);
    expect(manualRows[0].referenceType).toBe("ADMIN");
    expect(manualRows[0].type).not.toBe("ORDER");
  });
});
