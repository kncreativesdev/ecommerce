import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin, provisionEmployee } from "../../src/modules/users/users.service.js";

/**
 * Phase 2C-5 customer-owned resource isolation (live HTTP + MySQL).
 *
 * Dedicated companies A, B, and S(uspended) with provisioned admins,
 * a HEAD, stamped customers, and per-company catalog. Addresses, cart,
 * wishlist, and notifications are caller-scoped by construction
 * (req.user.id is the only owner key); ADMIN customer management and
 * wishlist product adds carry the company predicate. Cross-company ids
 * fail exactly like unknown ids.
 *
 * Cleanup: cart lines removed, catalog deactivated, B notifications
 * left as ordinary rows (repo convention); users/companies persist.
 */

const RUN = `TSTCU${Date.now().toString(36).toUpperCase()}`;

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
      firstName: "CustIso",
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
      name: `${RUN} Thing ${tag}`,
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
      price: "75.00",
      isActive: true,
      companyId,
    },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, quantity: 10, reservedQuantity: 0 } });
  return { category, product, variant };
}

async function createAddress(userId, label) {
  const res = await request(app)
    .post("/api/v1/addresses")
    .set(headersFor(userId))
    .send({
      label,
      fullName: "Cust Iso",
      phone: "9999999999",
      addressLine1: "9 Isolation Road",
      city: "Ludhiana",
      state: "Punjab",
      postalCode: "141002",
      country: "India",
    });
  expect(res.status).toBe(201);
  return res.body.data.address;
}

beforeAll(async () => {
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["s", "SUSPENDED"]]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN.toLowerCase()}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "CustIso",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = admin;
  }
  const headA = await provisionEmployee(
    { id: ctx.adminA.id, companyId: ctx.companyA.id, roles: ["ADMIN"] },
    { email: `${RUN.toLowerCase()}-head-a@example.test`, password: "TestPass123!", firstName: "CustIso", lastName: "HeadA", role: "HEAD" }
  );
  createdUserIds.push(headA.id);
  ctx.headA = await prisma.user.findUnique({ where: { id: headA.id } });

  ctx.catA = await createCatalog("a", ctx.companyA.id);
  ctx.catB = await createCatalog("b", ctx.companyB.id);
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.customerB = await createUser("customer-b", "CUSTOMER", ctx.companyB.id);
  ctx.customerS = await createUser("customer-s", "CUSTOMER", ctx.companyS.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);
  ctx.addressA = await createAddress(ctx.customerA.id, "HomeA");
  ctx.addressB = await createAddress(ctx.customerB.id, "HomeB");

  // Seed B notifications realistically: B places and cancels an order.
  await request(app).post("/api/v1/cart/items").set(headersFor(ctx.customerB.id)).send({
    variantId: ctx.catB.variant.id,
    quantity: 1,
  }).expect(200);
  const order = await request(app).post("/api/v1/orders").set(headersFor(ctx.customerB.id)).send({
    shippingAddressId: ctx.addressB.id,
  });
  expect(order.status).toBe(201);
  const cancel = await request(app)
    .post(`/api/v1/orders/${order.body.data.order.id}/cancel`)
    .set(headersFor(ctx.customerB.id));
  expect(cancel.status).toBe(200);
  const notifications = await request(app).get("/api/v1/notifications").set(headersFor(ctx.customerB.id));
  expect(notifications.status).toBe(200);
  expect(notifications.body.data.notifications.length).toBeGreaterThan(0);
  ctx.notificationB = notifications.body.data.notifications[0];

  // B wishlist item for cross-delete attempts.
  const wish = await request(app).post("/api/v1/wishlist/items").set(headersFor(ctx.customerB.id)).send({
    productId: ctx.catB.product.id,
  });
  expect(wish.status).toBe(200);
  const list = await request(app).get("/api/v1/wishlist").set(headersFor(ctx.customerB.id));
  ctx.wishItemB = list.body.data.wishlist.items[0];

  // B cart line for cross-mutation attempts.
  await request(app).post("/api/v1/cart/items").set(headersFor(ctx.customerB.id)).send({
    variantId: ctx.catB.variant.id,
    quantity: 1,
  }).expect(200);
  const cart = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerB.id));
  ctx.cartItemB = cart.body.data.cart.items[0];
}, 120000);

afterAll(async () => {
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

describe("customer account isolation", () => {
  it("A reads and updates its own profile", async () => {
    const me = await request(app).get("/api/v1/users/me").set(headersFor(ctx.customerA.id));
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(ctx.customerA.id);
    const updated = await request(app)
      .patch("/api/v1/users/me")
      .set(headersFor(ctx.customerA.id))
      .send({ firstName: "Updated" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.user.firstName).toBe("Updated");
  });

  it("customers cannot target other user ids (role gate preserved)", async () => {
    const byId = await request(app).get(`/api/v1/users/${ctx.customerB.id}`).set(headersFor(ctx.customerA.id));
    expect(byId.status).toBe(403);
    expect(byId.body.error.code).toBe("AUTH_FORBIDDEN");
    const patch = await request(app)
      .patch(`/api/v1/users/${ctx.customerB.id}`)
      .set(headersFor(ctx.customerA.id))
      .send({ isActive: false });
    expect(patch.status).toBe(403);
  });

  it("duplicate email follows scoped rules after the composite change (Phase 2C-26)", async () => {
    // Unscoped (legacy) re-registration of a used email still 409s —
    // no domain means no company scope to disambiguate with.
    const dup = await request(app).post("/api/v1/auth/register").send({
      email: `${RUN.toLowerCase()}-customer-b@example.test`,
      password: "TestPass123!",
      firstName: "Duplicate",
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("AUTH_EMAIL_ALREADY_EXISTS");

    // The same email on another company's registered domain is a
    // separate account, not a conflict.
    const domain = `${RUN.toLowerCase()}-scope-a.example.test`;
    const row = await prisma.companyDomain.create({
      data: { companyId: ctx.companyA.id, domain, isPrimary: false, isActive: true },
    });
    try {
      const scoped = await request(app)
        .post("/api/v1/auth/register")
        .set("Host", domain)
        .send({
          email: `${RUN.toLowerCase()}-customer-b@example.test`,
          password: "TestPass123!",
          firstName: "Scoped",
        });
      expect(scoped.status).toBe(201);
      createdUserIds.push(scoped.body.data.user.id);
      ctx.scopedTwinId = scoped.body.data.user.id;
      const stored = await prisma.user.findFirst({
        where: { email: `${RUN.toLowerCase()}-customer-b@example.test`, companyId: ctx.companyA.id },
        select: { id: true },
      });
      expect(stored.id).toBe(scoped.body.data.user.id);
    } finally {
      await prisma.companyDomain.deleteMany({ where: { id: row.id } });
    }
  });
});

describe("address isolation", () => {
  it("A lists only its own addresses", async () => {
    const res = await request(app).get("/api/v1/addresses").set(headersFor(ctx.customerA.id));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a) => a.id);
    expect(ids).toContain(ctx.addressA.id);
    expect(ids).not.toContain(ctx.addressB.id);
  });

  it("A cannot read/update/delete/make-default B's address", async () => {
    const get = await request(app).get(`/api/v1/addresses/${ctx.addressB.id}`).set(headersFor(ctx.customerA.id));
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe("ADDRESS_NOT_FOUND");
    const patch = await request(app)
      .patch(`/api/v1/addresses/${ctx.addressB.id}`)
      .set(headersFor(ctx.customerA.id))
      .send({ fullName: "Hijacked" });
    expect(patch.status).toBe(404);
    const def = await request(app)
      .patch(`/api/v1/addresses/${ctx.addressB.id}`)
      .set(headersFor(ctx.customerA.id))
      .send({ isDefault: true });
    expect(def.status).toBe(404);
    const del = await request(app).delete(`/api/v1/addresses/${ctx.addressB.id}`).set(headersFor(ctx.customerA.id));
    expect(del.status).toBe(404);
    expect(del.body.error.code).toBe("ADDRESS_NOT_FOUND");
    const reread = await prisma.address.findUnique({ where: { id: ctx.addressB.id } });
    expect(reread.fullName).not.toBe("Hijacked");
    expect(reread.isDefault).toBe(false);
  });

  it("address writes accept no client userId", async () => {
    const res = await request(app)
      .post("/api/v1/addresses")
      .set(headersFor(ctx.customerA.id))
      .send({
        userId: ctx.customerB.id,
        fullName: "No Override",
        phone: "9999999999",
        addressLine1: "1 Nowhere",
        city: "Ludhiana",
        state: "Punjab",
        postalCode: "141002",
        country: "India",
      });
    // Strict schemas reject unknown ownership fields outright.
    expect(res.status).toBe(422);
  });
});

describe("cart and wishlist isolation", () => {
  it("A uses its own cart; B's lines are untouchable", async () => {
    const own = await request(app).get("/api/v1/cart").set(headersFor(ctx.customerA.id));
    expect(own.status).toBe(200);
    const patch = await request(app)
      .patch(`/api/v1/cart/items/${ctx.cartItemB.id}`)
      .set(headersFor(ctx.customerA.id))
      .send({ quantity: 5 });
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe("CART_ITEM_NOT_FOUND");
    const del = await request(app)
      .delete(`/api/v1/cart/items/${ctx.cartItemB.id}`)
      .set(headersFor(ctx.customerA.id));
    expect(del.status).toBe(404);
  });

  it("A cannot add B's variant (re-proof at the customer surface)", async () => {
    const res = await request(app)
      .post("/api/v1/cart/items")
      .set(headersFor(ctx.customerA.id))
      .send({ variantId: ctx.catB.variant.id, quantity: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
  });

  it("A manages its own wishlist; B's product and lines are rejected", async () => {
    const add = await request(app)
      .post("/api/v1/wishlist/items")
      .set(headersFor(ctx.customerA.id))
      .send({ productId: ctx.catA.product.id });
    expect(add.status).toBe(200);
    const cross = await request(app)
      .post("/api/v1/wishlist/items")
      .set(headersFor(ctx.customerA.id))
      .send({ productId: ctx.catB.product.id });
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe("PRODUCT_NOT_FOUND");
    const unknown = await request(app)
      .post("/api/v1/wishlist/items")
      .set(headersFor(ctx.customerA.id))
      .send({ productId: randomUUID() });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("PRODUCT_NOT_FOUND");
    const del = await request(app)
      .delete(`/api/v1/wishlist/items/${ctx.wishItemB.id}`)
      .set(headersFor(ctx.customerA.id));
    expect(del.status).toBe(404);
    const list = await request(app).get("/api/v1/wishlist").set(headersFor(ctx.customerA.id));
    expect(list.body.data.wishlist.items.map((i) => i.productId)).not.toContain(ctx.catB.product.id);
    // B's wishlist is intact.
    const listB = await request(app).get("/api/v1/wishlist").set(headersFor(ctx.customerB.id));
    expect(listB.body.data.wishlist.items.map((i) => i.id)).toContain(ctx.wishItemB.id);
  });
});

describe("customer notification isolation", () => {
  it("A and B inboxes never overlap", async () => {
    const listA = await request(app).get("/api/v1/notifications").set(headersFor(ctx.customerA.id));
    expect(listA.status).toBe(200);
    const idsA = listA.body.data.notifications.map((n) => n.id);
    expect(idsA).not.toContain(ctx.notificationB.id);
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
});

describe("ADMIN customer surface isolation", () => {
  it("A list contains only Company A customers", async () => {
    const res = await request(app).get("/api/v1/users").set(adminA());
    expect(res.status).toBe(200);
    // Company A holds adminA + customerA + headA plus the scoped
    // same-email twin from the registration test above (same email as
    // B's customer, but a distinct Company A account).
    expect(res.body.meta.total).toBe(4);
    const ids = res.body.data.users.map((u) => u.id);
    expect(ids).toContain(ctx.customerA.id);
    expect(ids).toContain(ctx.scopedTwinId);
    expect(ids).not.toContain(ctx.customerB.id);
    expect(ids).not.toContain(ctx.adminB.id);
  });

  it("A cannot read or deactivate B's customer", async () => {
    const get = await request(app).get(`/api/v1/users/${ctx.customerB.id}`).set(adminA());
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe("USER_NOT_FOUND");
    const ban = await request(app)
      .patch(`/api/v1/users/${ctx.customerB.id}`)
      .set(adminA())
      .send({ isActive: false });
    expect(ban.status).toBe(404);
    expect((await prisma.user.findUnique({ where: { id: ctx.customerB.id } })).isActive).toBe(true);
  });

  it("A deactivates and restores its own customer, search stays scoped", async () => {
    const ban = await request(app)
      .patch(`/api/v1/users/${ctx.customerA.id}`)
      .set(adminA())
      .send({ isActive: false });
    expect(ban.status).toBe(200);
    expect(ban.body.data.user.isActive).toBe(false);
    const search = await request(app)
      .get("/api/v1/users")
      .query({ search: `${RUN.toLowerCase()}-customer-b` })
      .set(adminA());
    expect(search.status).toBe(200);
    // Only Company A's own same-email twin matches: B's customer never
    // leaks into A's scoped search.
    expect(search.body.meta.total).toBe(1);
    expect(search.body.data.users[0].id).toBe(ctx.scopedTwinId);
    const restore = await request(app)
      .patch(`/api/v1/users/${ctx.customerA.id}`)
      .set(adminA())
      .send({ isActive: true });
    expect(restore.status).toBe(200);
    expect(restore.body.data.user.isActive).toBe(true);
  });

  it("HEAD gets a MEMBER-scoped user list instead of a forbidden error", async () => {
    // Phase 2C-31: HEAD callers are authorized on the user surface but
    // forced to MEMBER scope by the service (ADMIN behavior unchanged).
    const created = await request(app)
      .post("/api/v1/users")
      .set(headersFor(ctx.headA.id, ["HEAD"]))
      .send({
        email: `${RUN.toLowerCase()}-visible-member@example.test`,
        password: "TestPass123!",
        firstName: "CustIso",
        lastName: "Visible",
        role: "MEMBER",
      });
    expect(created.status).toBe(201);
    createdUserIds.push(created.body.data.user.id);

    const res = await request(app).get("/api/v1/users").set(headersFor(ctx.headA.id, ["HEAD"]));
    expect(res.status).toBe(200);
    expect(res.body.data.users.length).toBeGreaterThan(0);
    for (const row of res.body.data.users) {
      expect(row.roles).toEqual(["MEMBER"]);
      expect(row).not.toHaveProperty("passwordHash");
    }
    const emails = res.body.data.users.map((row) => row.email);
    expect(emails).toContain(`${RUN.toLowerCase()}-visible-member@example.test`);
    expect(emails).not.toContain(ctx.adminA.email);
    expect(emails).not.toContain(ctx.headA.email);
  });
});

describe("override channels, platform, suspension", () => {
  it("body companyId is rejected; query/header ids are ignored", async () => {
    const strict = await request(app)
      .patch("/api/v1/users/me")
      .set(headersFor(ctx.customerA.id))
      .send({ firstName: "Override", companyId: ctx.companyB.id });
    expect(strict.status).toBe(422);
    const ignored = await request(app)
      .get("/api/v1/addresses")
      .query({ companyId: ctx.companyB.id })
      .set({ ...headersFor(ctx.customerA.id), "x-company-id": ctx.companyB.id });
    expect(ignored.status).toBe(200);
    expect(ignored.body.data.map((a) => a.id)).toContain(ctx.addressA.id);
    const wishStrict = await request(app)
      .post("/api/v1/wishlist/items")
      .set(headersFor(ctx.customerA.id))
      .send({ productId: ctx.catA.product.id, companyId: ctx.companyB.id });
    expect(wishStrict.status).toBe(422);
  });

  it("SUPER_ADMIN has no customer operational access", async () => {
    const list = await request(app).get("/api/v1/users").set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("suspended company customer is rejected (Phase 2C-13)", async () => {
    const me = await request(app).get("/api/v1/users/me").set(headersFor(ctx.customerS.id));
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe("COMPANY_SUSPENDED");
    const addresses = await request(app).get("/api/v1/addresses").set(headersFor(ctx.customerS.id));
    expect(addresses.status).toBe(403);
    expect(addresses.body.error.code).toBe("COMPANY_SUSPENDED");
  });
});
