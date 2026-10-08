import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-12 domain-separated storefront isolation (live HTTP + MySQL).
 *
 * Dedicated companies A, B, and S(uspended) with registered domains and
 * API-created catalog. Public reads resolve their company from Host
 * alone: cross-company ids 404 exactly like unknown ids, unknown hosts
 * fail closed on storefront reads, and authenticated identity still
 * governs operations regardless of Host.
 *
 * Product lists carry no search params in this codebase (status scope
 * only, verified by inspection) — so there is no OR-expression to
 * escape; the company predicate is the whole filter.
 *
 * Cleanup: catalog deactivated, domains/companies/users removed.
 */

const RUN = `TSTSF${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const HOST_A = `${RUN}-a.example.test`;
const HOST_B = `${RUN}-b.example.test`;
const HOST_S = `${RUN}-s.example.test`;
const HOST_UNKNOWN = `${RUN}-nope.example.test`;

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];
const createdDomainIds = [];

const headersFor = (id, roles = ["ADMIN"]) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "StoreIso",
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

beforeAll(async () => {
  for (const [tag, status, host] of [["a", "ACTIVE", HOST_A], ["b", "ACTIVE", HOST_B], ["s", "SUSPENDED", HOST_S]]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "StoreIso",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = admin;
    const domain = await prisma.companyDomain.create({
      data: { companyId: company.id, domain: host, isPrimary: true, isActive: true },
    });
    createdDomainIds.push(domain.id);
  }
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);

  for (const tag of ["A", "B"]) {
    const adminId = ctx[`admin${tag}`].id;
    const cat = await request(app).post("/api/v1/categories").set(headersFor(adminId)).send({
      name: `${RUN} Cat ${tag}`,
    });
    expect(cat.status).toBe(201);
    const product = await request(app).post("/api/v1/products").set(headersFor(adminId)).send({
      name: `${RUN} Widget ${tag}`,
      categoryId: cat.body.data.category.id,
      variants: [{ sku: `${RUN}-${tag}`, name: "Base", price: "25.00" }],
    });
    expect(product.status).toBe(201);
    ctx[`cat${tag}`] = cat.body.data.category;
    ctx[`product${tag}`] = product.body.data.product;
    ctx[`variant${tag}`] = product.body.data.product.variants[0];
    await prisma.inventory.create({
      data: { variantId: ctx[`variant${tag}`].id, quantity: 10, reservedQuantity: 0 },
    });
  }

  // One review per company through a real delivered order.
  for (const tag of ["A", "B"]) {
    const customer = await createUser(`customer-${tag.toLowerCase()}`, "CUSTOMER", ctx[`company${tag}`].id);
    ctx[`customer${tag}`] = customer;
    const address = await request(app)
      .post("/api/v1/addresses")
      .set(headersFor(customer.id, ["CUSTOMER"]))
      .send({
        fullName: "Store Iso",
        phone: "9999999999",
        addressLine1: "4 Isolation Road",
        city: "Ludhiana",
        state: "Punjab",
        postalCode: "141002",
        country: "India",
      });
    expect(address.status).toBe(201);
    await request(app).post("/api/v1/cart/items").set(headersFor(customer.id, ["CUSTOMER"])).send({
      variantId: ctx[`variant${tag}`].id,
      quantity: 1,
    }).expect(200);
    const order = await request(app).post("/api/v1/orders").set(headersFor(customer.id, ["CUSTOMER"])).send({
      shippingAddressId: address.body.data.address.id,
    });
    expect(order.status).toBe(201);
    for (const status of ["CONFIRMED", "PROCESSING", "DISPATCHED", "IN_TRANSIT", "ARRIVED_IN_CITY", "OUT_FOR_DELIVERY", "DELIVERED"]) {
      const step = await request(app)
        .patch(`/api/v1/orders/admin/${order.body.data.order.id}/status`)
        .set(headersFor(ctx[`admin${tag}`].id))
        .send({ status });
      expect(step.status).toBe(200);
    }
    const item = await prisma.orderItem.findFirst({
      where: { orderId: order.body.data.order.id },
      select: { id: true },
    });
    const review = await request(app)
      .post("/api/v1/reviews")
      .set(headersFor(customer.id, ["CUSTOMER"]))
      .send({ orderItemId: item.id, rating: 5, title: `Great ${tag}` });
    expect(review.status).toBe(201);
    ctx[`review${tag}`] = review.body.data.review;
  }

  for (const tag of ["A", "B"]) {
    const announcement = await request(app)
      .post("/api/v1/announcements/admin")
      .set(headersFor(ctx[`admin${tag}`].id))
      .send({ message: `${RUN} Bar ${tag}`, priority: 5 });
    expect(announcement.status).toBe(201);
    ctx[`announcement${tag}`] = announcement.body.data.announcement;
  }
}, 180000);

afterAll(async () => {
  // Repo convention: customers own immutable orders (Restrict), so test
  // users/companies persist as ordinary rows; catalog is deactivated,
  // cart lines and domain rows (referenced by nothing) are removed.
  await prisma.cartItem.deleteMany({
    where: { cart: { userId: { in: [ctx.customerA?.id, ctx.customerB?.id].filter(Boolean) } } },
  });
  for (const tag of ["A", "B"]) {
    const product = ctx[`product${tag}`];
    const cat = ctx[`cat${tag}`];
    if (product) {
      await prisma.productVariant.updateMany({ where: { productId: product.id }, data: { isActive: false } });
      await prisma.product.updateMany({ where: { id: product.id }, data: { isActive: false } });
    }
    if (cat) {
      await prisma.category.updateMany({ where: { id: cat.id }, data: { isActive: false } });
    }
    const announcement = ctx[`announcement${tag}`];
    if (announcement) {
      try {
        await prisma.siteAnnouncement.deleteMany({ where: { id: announcement.id } });
      } catch { /* best-effort */ }
    }
  }
  if (createdDomainIds.length > 0) {
    await prisma.companyDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
  }
  await prisma.$disconnect();
});

describe("domain-separated categories", () => {
  it("each host lists only its own categories", async () => {
    const resA = await request(app).get("/api/v1/categories").set("Host", HOST_A);
    expect(resA.status).toBe(200);
    expect(resA.body.data.map((c) => c.id)).toContain(ctx.catA.id);
    expect(resA.body.data.map((c) => c.id)).not.toContain(ctx.catB.id);
    const resB = await request(app).get("/api/v1/categories").set("Host", HOST_B);
    expect(resB.body.data.map((c) => c.id)).toContain(ctx.catB.id);
    expect(resB.body.data.map((c) => c.id)).not.toContain(ctx.catA.id);
  });

  it("cross-company category detail fails closed", async () => {
    const res = await request(app).get(`/api/v1/categories/${ctx.catB.id}`).set("Host", HOST_A);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CATEGORY_NOT_FOUND");
    expect(JSON.stringify(res.body)).not.toContain(ctx.catB.name);
    const back = await request(app).get(`/api/v1/categories/${ctx.catA.id}`).set("Host", HOST_B);
    expect(back.status).toBe(404);
  });
});

describe("domain-separated products and nested data", () => {
  it("each host lists only its own products", async () => {
    const resA = await request(app).get("/api/v1/products").set("Host", HOST_A);
    expect(resA.status).toBe(200);
    expect(resA.body.data.map((p) => p.id)).toContain(ctx.productA.id);
    expect(resA.body.data.map((p) => p.id)).not.toContain(ctx.productB.id);
  });

  it("cross-company product detail fails closed without field leakage", async () => {
    const res = await request(app).get(`/api/v1/products/${ctx.productB.id}`).set("Host", HOST_A);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(ctx.productB.name);
    expect(body).not.toContain(ctx.variantB.sku);
  });

  it("nested data follows the gated root product", async () => {
    const res = await request(app).get(`/api/v1/products/${ctx.productA.id}`).set("Host", HOST_A);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body.data);
    expect(body).toContain(ctx.variantA.sku);
    expect(body).not.toContain(ctx.variantB.sku);
    expect(body).not.toContain(ctx.productB.name);
  });

  it("product media reads follow the product gate", async () => {
    const cross = await request(app)
      .get(`/api/v1/products/${ctx.productB.id}/images`)
      .set("Host", HOST_A);
    expect(cross.status).toBe(404);
  });
});

describe("reviews and announcements per domain", () => {
  it("product reviews never mix companies", async () => {
    const listA = await request(app).get(`/api/v1/reviews/product/${ctx.productA.id}`).set("Host", HOST_A);
    expect(listA.status).toBe(200);
    expect(listA.body.data.map((r) => r.id)).toContain(ctx.reviewA.id);
    expect(listA.body.data.map((r) => r.id)).not.toContain(ctx.reviewB.id);
    const cross = await request(app).get(`/api/v1/reviews/product/${ctx.productB.id}`).set("Host", HOST_A);
    expect(cross.status).toBe(404);
  });

  it("each host resolves its own current announcement", async () => {
    // The public shape intentionally carries no id (message/link only),
    // so isolation is proven by message content per host.
    const resA = await request(app).get("/api/v1/announcements/current").set("Host", HOST_A);
    expect(resA.status).toBe(200);
    expect(resA.body.data.announcement?.message).toBe(ctx.announcementA.message);
    const resB = await request(app).get("/api/v1/announcements/current").set("Host", HOST_B);
    expect(resB.status).toBe(200);
    expect(resB.body.data.announcement?.message).toBe(ctx.announcementB.message);
  });
});

describe("unknown hosts fail closed on storefront reads", () => {
  it("no catalog, review, or announcement data without a resolved company", async () => {
    const products = await request(app).get("/api/v1/products").set("Host", HOST_UNKNOWN);
    expect(products.status).toBe(404);
    expect(products.body.error.code).toBe("PRODUCT_NOT_FOUND");
    const categories = await request(app).get("/api/v1/categories").set("Host", HOST_UNKNOWN);
    expect(categories.status).toBe(404);
    const detail = await request(app).get(`/api/v1/products/${ctx.productA.id}`).set("Host", HOST_UNKNOWN);
    expect(detail.status).toBe(404);
    const reviews = await request(app).get(`/api/v1/reviews/product/${ctx.productA.id}`).set("Host", HOST_UNKNOWN);
    expect(reviews.status).toBe(404);
    const current = await request(app).get("/api/v1/announcements/current").set("Host", HOST_UNKNOWN);
    expect(current.status).toBe(404);
  });
});

describe("identity precedence and non-enforcement", () => {
  it("authenticated operations ignore Host; public reads follow it", async () => {
    // ADMIN-A on B's host still manages Company A (identity governs writes).
    const created = await request(app)
      .post("/api/v1/categories")
      .set("Host", HOST_B)
      .set(headersFor(ctx.adminA.id))
      .send({ name: `${RUN} Precedence` });
    expect(created.status).toBe(201);
    const stored = await prisma.category.findUnique({ where: { id: created.body.data.category.id } });
    expect(stored.companyId).toBe(ctx.companyA.id);
    await prisma.category.delete({ where: { id: stored.id } });
    // ...while the same request's public reads follow the Host.
    const pub = await request(app).get("/api/v1/products").set("Host", HOST_B);
    expect(pub.status).toBe(200);
    expect(pub.body.data.map((p) => p.id)).not.toContain(ctx.productA.id);
  });

  it("SUPER_ADMIN sees public data like anyone; suspended hosts are rejected (Phase 2C-13)", async () => {
    const pub = await request(app)
      .get("/api/v1/products")
      .set("Host", HOST_A)
      .set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(pub.status).toBe(200);
    const susp = await request(app).get("/api/v1/products").set("Host", HOST_S);
    expect(susp.status).toBe(403);
    expect(susp.body.error.code).toBe("COMPANY_SUSPENDED");
  });
});
