import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";

/**
 * Phase 3-6 returns + coupons RBAC (live HTTP + MySQL).
 *
 * Returns: the matrix contains no return grants and the admin surface
 * is read-only by design (`GET /returns`, `GET /returns/:id`), so NO
 * return route changed — this suite locks the preserved posture
 * (ADMIN reads, HEAD/MEMBER/CUSTOMER/SUPER_ADMIN excluded, customer
 * flow untouched) instead of inventing mutations.
 *
 * Coupons: explicit namespace (HEAD CREATE/READ/UPDATE/DEACTIVATE,
 * MEMBER READ-only) wired verbatim —
 * reads → ADMIN/HEAD/MEMBER; create + update (incl. isActive toggles)
 * → ADMIN/HEAD; hard delete → ADMIN only (COUPON_IN_USE guard kept).
 * Customer quote (`POST /validate`) unchanged.
 */

const RUN = `TSTRC${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const PASSWORD = "TestPass123!";

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function ensureRole(name) {
  let role = await prisma.role.findUnique({ where: { name } });
  if (!role) {
    role = await prisma.role.create({ data: { name } });
  }
  return role;
}

async function createStaff(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      firstName: "Rc",
      lastName: tag,
      phone: "9999999999",
      companyId,
    },
  });
  createdUserIds.push(user.id);
  const role = await ensureRole(roleName);
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

const couponBody = (tag, extra = {}) => ({
  code: `${RUN}-${tag}`.toUpperCase().slice(0, 50),
  discountType: "FIXED",
  discountValue: "5.00",
  ...extra,
});

async function placeOrder(customerId, addressId, variantId, extra = {}) {
  const token = signAccessToken({ id: customerId, roles: ["CUSTOMER"] });
  const headers = { Authorization: `Bearer ${token}` };
  const added = await request(app).post("/api/v1/cart/items").set(headers).send({ variantId, quantity: 1 });
  expect(added.status).toBe(200);
  const order = await request(app).post("/api/v1/orders").set(headers).send({ shippingAddressId: addressId, ...extra });
  expect(order.status).toBe(201);
  return order.body.data.order;
}

async function transitionOrder(orderId, adminHeaders, status) {
  const res = await request(app).patch(`/api/v1/orders/admin/${orderId}/status`).set(adminHeaders).send({ status });
  expect(res.status).toBe(200);
  return res.body.data.order;
}

beforeAll(async () => {
  ctx.superAdmin = await createStaff("super", "SUPER_ADMIN", null);
  for (const [tag, status] of [["a", "ACTIVE"], ["b", "ACTIVE"]]) {
    // eslint-disable-next-line no-await-in-loop
    const company = await prisma.company.create({ data: { name: `${RUN} Rc Co ${tag}`, status } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
  }
  ctx.adminA = await createStaff("admin-a", "ADMIN", ctx.companyA.id);
  await prisma.company.update({ where: { id: ctx.companyA.id }, data: { adminUserId: ctx.adminA.id } });
  ctx.headA = await createStaff("head-a", "HEAD", ctx.companyA.id);
  ctx.memberA = await createStaff("member-a", "MEMBER", ctx.companyA.id);
  ctx.customerA = await createStaff("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.adminB = await createStaff("admin-b", "ADMIN", ctx.companyB.id);
  await prisma.company.update({ where: { id: ctx.companyB.id }, data: { adminUserId: ctx.adminB.id } });

  // Returns catalog + delivered order in company A.
  const category = await prisma.category.create({ data: { name: `${RUN} cat`, slug: `${RUN}-cat`, companyId: ctx.companyA.id } });
  const product = await prisma.product.create({ data: { name: `${RUN} prod`, slug: `${RUN}-prod`, categoryId: category.id, companyId: ctx.companyA.id } });
  const variant = await prisma.productVariant.create({ data: { productId: product.id, sku: `${RUN}-sku`, name: "Standard", price: "60.00", companyId: ctx.companyA.id } });
  await prisma.inventory.create({ data: { variantId: variant.id, quantity: 30, reservedQuantity: 0 } });
  ctx.variantA = variant;
  const adminHeaders = headersFor(ctx.adminA.id, ["ADMIN"]);
  const token = signAccessToken({ id: ctx.customerA.id, roles: ["CUSTOMER"] });
  const address = await request(app).post("/api/v1/addresses").set({ Authorization: `Bearer ${token}` }).send({
    fullName: "Rc Tester", phone: "9999999999", addressLine1: "1 Test Street", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "India",
  });
  expect(address.status).toBe(201);
  ctx.addressA = address.body.data.address;
  ctx.orderR = await placeOrder(ctx.customerA.id, ctx.addressA.id, ctx.variantA.id);
  for (const status of ["CONFIRMED", "PROCESSING", "DISPATCHED", "IN_TRANSIT", "ARRIVED_IN_CITY", "OUT_FOR_DELIVERY", "DELIVERED"]) {
    // eslint-disable-next-line no-await-in-loop
    await transitionOrder(ctx.orderR.id, adminHeaders, status);
  }
  const ret = await request(app).post(`/api/v1/orders/${ctx.orderR.id}/returns`).set({ Authorization: `Bearer ${token}` }).send({ reason: "DAMAGED" });
  expect(ret.status).toBe(201);
  ctx.returnA = ret.body.data.returnRequest;

  // Foreign coupon in company B.
  const couponB = await prisma.coupon.create({
    data: { code: `${RUN}-B`.toUpperCase().slice(0, 50), discountType: "FIXED", discountValue: "5.00", companyId: ctx.companyB.id },
  });
  ctx.couponB = couponB;
}, 180000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { companyId: { in: createdCompanyIds } },
        { resourceId: { in: createdUserIds } },
        { actorId: { in: createdUserIds } },
      ],
    },
  });
  const companyWhere = { user: { companyId: { in: createdCompanyIds } } };
  const orderIds = (await prisma.order.findMany({ where: companyWhere, select: { id: true } })).map((row) => row.id);
  if (orderIds.length > 0) {
    await prisma.returnRequestHistory.deleteMany({ where: { returnRequest: { orderId: { in: orderIds } } } });
    await prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.couponUsage.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  const companyIds = createdCompanyIds;
  const coupons = await prisma.coupon.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } });
  const couponIds = coupons.map((row) => row.id);
  if (couponIds.length > 0) {
    await prisma.couponHistory.deleteMany({ where: { couponId: { in: couponIds } } });
    await prisma.coupon.deleteMany({ where: { id: { in: couponIds } } });
  }
  const variantWhere = { companyId: { in: companyIds } };
  // Carts reference variants (Restrict) and must go before variants.
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.address.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.inventoryTransaction.deleteMany({ where: { inventory: { variant: variantWhere } } });
  await prisma.inventory.deleteMany({ where: { variant: variantWhere } });
  await prisma.productVariant.deleteMany({ where: variantWhere });
  await prisma.product.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.category.deleteMany({ where: { companyId: { in: companyIds } } });
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

const adminA = () => headersFor(ctx.adminA.id, ["ADMIN"]);
const headA = () => headersFor(ctx.headA.id, ["HEAD"]);
const memberA = () => headersFor(ctx.memberA.id, ["MEMBER"]);

describe("returns admin reads stay ADMIN-only", () => {
  it("ADMIN lists and reads; HEAD/MEMBER/CUSTOMER/SUPER_ADMIN/anon excluded", async () => {
    const list = await request(app).get("/api/v1/returns").set(adminA());
    expect(list.status).toBe(200);
    expect(list.body.data.returns.map((row) => row.id)).toContain(ctx.returnA.id);
    const detail = await request(app).get(`/api/v1/returns/${ctx.returnA.id}`).set(adminA());
    expect(detail.status).toBe(200);
    expect(detail.body.data.returnRequest.id).toBe(ctx.returnA.id);

    expect((await request(app).get("/api/v1/returns").set(headA())).status).toBe(403);
    expect((await request(app).get(`/api/v1/returns/${ctx.returnA.id}`).set(headA())).status).toBe(403);
    expect((await request(app).get("/api/v1/returns").set(memberA())).status).toBe(403);
    expect((await request(app).get("/api/v1/returns").set(headersFor(ctx.customerA.id, ["CUSTOMER"]))).status).toBe(403);
    expect((await request(app).get("/api/v1/returns").set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]))).status).toBe(403);
    expect((await request(app).get("/api/v1/returns")).status).toBe(401);
  });

  it("customer return flow is untouched by RBAC", async () => {
    const token = signAccessToken({ id: ctx.customerA.id, roles: ["CUSTOMER"] });
    const headers = { Authorization: `Bearer ${token}` };
    const own = await request(app).get(`/api/v1/orders/${ctx.orderR.id}/returns`).set(headers);
    expect(own.status).toBe(200);
    expect(own.body.data.returnRequest.id).toBe(ctx.returnA.id);
    const dupe = await request(app).post(`/api/v1/orders/${ctx.orderR.id}/returns`).set(headers).send({ reason: "OTHER", details: "again" });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe("RETURN_ALREADY_REQUESTED");
  });

  it("suspended company keeps HEAD excluded from returns", async () => {
    const superHeaders = headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
    const suspended = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/suspend`).set(superHeaders);
    expect(suspended.status).toBe(200);
    try {
      const res = await request(app).get("/api/v1/returns").set(headA());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
    } finally {
      const restored = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/restore`).set(superHeaders);
      expect(restored.status).toBe(200);
    }
  });
});

describe("coupon create by role", () => {
  it("ADMIN creates company-stamped (unchanged)", async () => {
    const res = await request(app).post("/api/v1/coupons").set(adminA()).send(couponBody("admin"));
    expect(res.status).toBe(201);
    ctx.couponA = res.body.data.coupon;
    const stored = await prisma.coupon.findUnique({ where: { id: ctx.couponA.id } });
    expect(stored.companyId).toBe(ctx.companyA.id);
  });

  it("HEAD creates company-stamped", async () => {
    const res = await request(app).post("/api/v1/coupons").set(headA()).send(couponBody("head"));
    expect(res.status).toBe(201);
    ctx.couponH = res.body.data.coupon;
    const stored = await prisma.coupon.findUnique({ where: { id: ctx.couponH.id } });
    expect(stored.companyId).toBe(ctx.companyA.id);
  });

  it("MEMBER, CUSTOMER, SUPER_ADMIN, and anonymous creates refused with nothing stored", async () => {
    const bodies = ["member", "customer", "platform", "anon"];
    const attempts = [
      request(app).post("/api/v1/coupons").set(memberA()).send(couponBody(bodies[0])),
      request(app).post("/api/v1/coupons").set(headersFor(ctx.customerA.id, ["CUSTOMER"])).send(couponBody(bodies[1])),
      request(app).post("/api/v1/coupons").set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"])).send(couponBody(bodies[2])),
      request(app).post("/api/v1/coupons").send(couponBody(bodies[3])),
    ];
    const expected = [403, 403, 403, 401];
    for (let i = 0; i < attempts.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await attempts[i];
      expect(res.status).toBe(expected[i]);
    }
    expect(await prisma.coupon.count({ where: { code: { in: bodies.map((tag) => couponBody(tag).code) } } })).toBe(0);
  });

  it("body companyId smuggling is rejected", async () => {
    const res = await request(app).post("/api/v1/coupons").set(headA()).send({ ...couponBody("smuggled"), companyId: ctx.companyB.id });
    expect(res.status).toBe(422);
  });
});

describe("coupon update and lifecycle by role", () => {
  it("HEAD updates and toggles active state; ADMIN unchanged", async () => {
    const updated = await request(app).patch(`/api/v1/coupons/${ctx.couponH.id}`).set(headA()).send({ description: "head edit" });
    expect(updated.status).toBe(200);
    const off = await request(app).patch(`/api/v1/coupons/${ctx.couponH.id}`).set(headA()).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.coupon.isActive).toBe(false);
    const on = await request(app).patch(`/api/v1/coupons/${ctx.couponH.id}`).set(headA()).send({ isActive: true });
    expect(on.status).toBe(200);

    const admin = await request(app).patch(`/api/v1/coupons/${ctx.couponH.id}`).set(adminA()).send({ description: "admin edit" });
    expect(admin.status).toBe(200);
  });

  it("MEMBER update refused with the row untouched", async () => {
    const res = await request(app).patch(`/api/v1/coupons/${ctx.couponH.id}`).set(memberA()).send({ description: "x" });
    expect(res.status).toBe(403);
    expect((await prisma.coupon.findUnique({ where: { id: ctx.couponH.id } })).description).toBe("admin edit");
  });

  it("DELETE stays ADMIN-only with the usage guard intact", async () => {
    // Consume couponA in a checkout so the guard has something to hold.
    const used = await placeOrder(ctx.customerA.id, ctx.addressA.id, ctx.variantA.id, { couponCode: couponBody("admin").code });
    expect(used.coupon.code).toBe(couponBody("admin").code);

    expect((await request(app).delete(`/api/v1/coupons/${ctx.couponH.id}`).set(headA())).status).toBe(403);
    expect((await request(app).delete(`/api/v1/coupons/${ctx.couponH.id}`).set(memberA())).status).toBe(403);

    const blocked = await request(app).delete(`/api/v1/coupons/${ctx.couponA.id}`).set(adminA());
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("COUPON_IN_USE");

    const fresh = await request(app).post("/api/v1/coupons").set(adminA()).send(couponBody("doomed"));
    expect(fresh.status).toBe(201);
    const removed = await request(app).delete(`/api/v1/coupons/${fresh.body.data.coupon.id}`).set(adminA());
    expect(removed.status).toBe(200);
  });
});

describe("coupon reads by role", () => {
  it("HEAD and MEMBER list, read, and view history; CUSTOMER stays on validate", async () => {
    for (const headers of [headA(), memberA()]) {
      // eslint-disable-next-line no-await-in-loop
      const list = await request(app).get("/api/v1/coupons").set(headers);
      expect(list.status).toBe(200);
      expect(list.body.data.coupons.length).toBeGreaterThan(0);
      // eslint-disable-next-line no-await-in-loop
      const detail = await request(app).get(`/api/v1/coupons/${ctx.couponH.id}`).set(headers);
      expect(detail.status).toBe(200);
      // eslint-disable-next-line no-await-in-loop
      const history = await request(app).get(`/api/v1/coupons/${ctx.couponH.id}/history`).set(headers);
      expect(history.status).toBe(200);
      expect(history.body.data.history.length).toBeGreaterThan(0);
    }
    const customerList = await request(app).get("/api/v1/coupons").set(headersFor(ctx.customerA.id, ["CUSTOMER"]));
    expect(customerList.status).toBe(403);

    // Customer quote surface unchanged: needs items in the cart.
    const token = signAccessToken({ id: ctx.customerA.id, roles: ["CUSTOMER"] });
    const cartHeaders = { Authorization: `Bearer ${token}` };
    const added = await request(app).post("/api/v1/cart/items").set(cartHeaders).send({ variantId: ctx.variantA.id, quantity: 1 });
    expect(added.status).toBe(200);
    const quote = await request(app).post("/api/v1/coupons/validate").set(cartHeaders).send({ code: couponBody("head").code });
    expect(quote.status).toBe(200);
  });
});

describe("coupon tenant and suspension boundaries", () => {
  it("foreign coupons read as neutral 404 with nothing changed", async () => {
    for (const res of [
      await request(app).get(`/api/v1/coupons/${ctx.couponB.id}`).set(headA()),
      await request(app).patch(`/api/v1/coupons/${ctx.couponB.id}`).set(headA()).send({ description: "x" }),
      await request(app).get(`/api/v1/coupons/${ctx.couponB.id}`).set(memberA()),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("COUPON_NOT_FOUND");
    }
    // DELETE stays ADMIN-only: HEAD is refused by role before any
    // company scoping runs (correct layering).
    expect((await request(app).delete(`/api/v1/coupons/${ctx.couponB.id}`).set(headA())).status).toBe(403);
    const ghost = await request(app).get("/api/v1/coupons/00000000-0000-0000-0000-000000000000").set(headA());
    expect(ghost.status).toBe(404);
    expect(ghost.body).toEqual({ success: false, error: { code: "COUPON_NOT_FOUND", message: "Coupon not found" } });
    expect((await prisma.coupon.findUnique({ where: { id: ctx.couponB.id } })).description).toBeNull();
  });

  it("suspended company blocks HEAD coupon mutations", async () => {
    const superHeaders = headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
    const suspended = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/suspend`).set(superHeaders);
    expect(suspended.status).toBe(200);
    try {
      const res = await request(app).post("/api/v1/coupons").set(headA()).send(couponBody("suspended"));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("COMPANY_SUSPENDED");
    } finally {
      const restored = await request(app).post(`/api/v1/companies/${ctx.companyA.id}/restore`).set(superHeaders);
      expect(restored.status).toBe(200);
    }
  });
});

describe("coupon RBAC audit and history", () => {
  it("records HEAD actor snapshots with safe metadata", async () => {
    const history = await prisma.couponHistory.findMany({ where: { couponId: ctx.couponH.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((row) => row.action).sort()).toEqual(["CREATED", "DEACTIVATED", "REACTIVATED", "UPDATED", "UPDATED"].sort());
    const events = await prisma.auditLog.findMany({ where: { resource: "COUPON", resourceId: ctx.couponH.id } });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.companyId).toBe(ctx.companyA.id);
      expect(["CREATED", "UPDATED", "DEACTIVATED", "REACTIVATED"]).toContain(event.action);
      const serialized = JSON.stringify(event);
      for (const leaked of ["password", "secret", "token"]) {
        expect(serialized.toLowerCase()).not.toContain(leaked);
      }
    }
    const created = events.find((event) => event.action === "CREATED");
    expect(created.actorRole).toBe("HEAD");
    expect(created.details).toMatchObject({ discountType: "FIXED", discountValue: "5.00" });
  });

  it("refused mutations emit no history or audit", async () => {
    const historyBefore = await prisma.couponHistory.count({ where: { couponId: ctx.couponH.id } });
    const auditBefore = await prisma.auditLog.count({ where: { resource: "COUPON", companyId: ctx.companyA.id } });
    const refused = await request(app).patch(`/api/v1/coupons/${ctx.couponH.id}`).set(memberA()).send({ description: "x" });
    expect(refused.status).toBe(403);
    expect(await prisma.couponHistory.count({ where: { couponId: ctx.couponH.id } })).toBe(historyBefore);
    expect(await prisma.auditLog.count({ where: { resource: "COUPON", companyId: ctx.companyA.id } })).toBe(auditBefore);
  });
});
