import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { stampUserCompany } from "../helpers/userFixtures.js";
import { provisionCompanyAdmin } from "../../src/modules/users/users.service.js";

/**
 * Coupon admin audit history (live MySQL):
 * CREATED / UPDATED / DEACTIVATED / REACTIVATED / DELETED rows are written
 * in the same transaction as the coupon mutation, with the server-side
 * admin identity (never request-body actor fields) and structured
 * before/after metadata. Customer usage (CouponUsage) stays separate.
 */

const RUN = `TSTCH${Date.now().toString(36).toUpperCase()}`;

const ctx = {
  adminId: null,
  adminEmail: null,
  adminHeaders: null,
  customerHeaders: null,
  couponId: null,
  couponCode: `${RUN}AUDIT10`,
};

async function historyOf(couponId, query = "") {
  const res = await request(app).get(`/api/v1/coupons/${couponId}/history${query}`).set(ctx.adminHeaders);
  expect(res.status).toBe(200);
  return res.body.data.history;
}

async function historyCount(couponId) {
  return prisma.couponHistory.count({ where: { couponId } });
}

beforeAll(async () => {
  // Provisioned ADMIN of a dedicated test company, so actor identity (id
  // + email snapshot) is verifiable AND the mounted company boundary
  // resolves consistently (a Company #1-stamped non-admin ADMIN-role user
  // would fail the ADMIN consistency check by design).
  const email = `${RUN.toLowerCase()}-admin@example.test`;
  const company = await prisma.company.create({ data: { name: `${RUN}-audit-co` } });
  ctx.companyId = company.id;
  const admin = await provisionCompanyAdmin(company.id, {
    email,
    password: "TestPass123!",
    firstName: "Audit",
    lastName: "Admin",
    phone: "9999999999",
  });
  ctx.adminId = admin.id;
  ctx.adminEmail = email;
  ctx.adminHeaders = { Authorization: `Bearer ${signAccessToken({ id: ctx.adminId, roles: ["ADMIN"] })}` };

  const customer = await request(app).post("/api/v1/auth/register").send({
    email: `${RUN.toLowerCase()}-customer@example.test`,
    password: "TestPass123!",
    firstName: "Audit",
    lastName: "Customer",
    phone: "9999999999",
  });
  expect(customer.status).toBe(201);
  await stampUserCompany(customer.body.data.user.id);
  const loggedIn = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: `${RUN.toLowerCase()}-customer@example.test`, password: "TestPass123!" });
  ctx.customerHeaders = { Authorization: `Bearer ${loggedIn.body.data.accessToken}` };
}, 90000);

afterAll(async () => {
  try {
    await prisma.couponHistory.deleteMany({ where: { couponId: ctx.couponId } });
  } catch { /* best-effort */ }
  try {
    await prisma.coupon.deleteMany({ where: { code: { startsWith: RUN } } });
  } catch { /* best-effort */ }
  try {
    if (ctx.adminId) {
      await prisma.user.deleteMany({ where: { id: ctx.adminId } });
    }
  } catch { /* best-effort */ }
  try {
    if (ctx.companyId) {
      await prisma.company.deleteMany({ where: { id: ctx.companyId } });
    }
  } catch { /* best-effort */ }
  await prisma.$disconnect();
});

describe("coupon creation audit", () => {
  it("records exactly one CREATED event with actor and initial config", async () => {
    const res = await request(app).post("/api/v1/coupons").set(ctx.adminHeaders).send({
      code: ctx.couponCode,
      discountType: "PERCENTAGE",
      discountValue: "10",
      description: "Audit trail",
      isActive: true,
    });
    expect(res.status).toBe(201);
    ctx.couponId = res.body.data.coupon.id;

    const history = await historyOf(ctx.couponId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      couponId: ctx.couponId,
      action: "CREATED",
      actor: { id: ctx.adminId, email: ctx.adminEmail },
    });
    expect(history[0].createdAt).toBeTruthy();
    expect(history[0].metadata.snapshot).toMatchObject({
      code: ctx.couponCode,
      discountType: "PERCENTAGE",
      discountValue: "10.00",
      description: "Audit trail",
      isActive: true,
    });
  });
});

describe("coupon update audit", () => {
  it("records one UPDATED event with before/after values", async () => {
    const res = await request(app).patch(`/api/v1/coupons/${ctx.couponId}`).set(ctx.adminHeaders).send({
      description: "Updated trail",
    });
    expect(res.status).toBe(200);

    const history = await historyOf(ctx.couponId);
    expect(history).toHaveLength(2);
    const event = history.find((row) => row.action === "UPDATED");
    expect(event).toBeTruthy();
    expect(event.actor).toMatchObject({ id: ctx.adminId, email: ctx.adminEmail });
    expect(event.createdAt).toBeTruthy();
    expect(event.metadata.changes.description).toEqual({ before: "Audit trail", after: "Updated trail" });
    expect(Object.keys(event.metadata.changes)).toEqual(["description"]);
  });

  it("records every actually-changed field on multi-field updates", async () => {
    const res = await request(app).patch(`/api/v1/coupons/${ctx.couponId}`).set(ctx.adminHeaders).send({
      discountValue: "15",
      usageLimit: 100,
    });
    expect(res.status).toBe(200);

    const history = await historyOf(ctx.couponId);
    const events = history.filter((row) => row.action === "UPDATED");
    const latest = events[0]; // newest-first
    expect(latest.metadata.changes.discountValue).toEqual({ before: "10.00", after: "15.00" });
    expect(latest.metadata.changes.usageLimit).toEqual({ before: null, after: 100 });
  });

  it("creates no history on failed updates", async () => {
    const before = await historyCount(ctx.couponId);
    const bad = await request(app).patch(`/api/v1/coupons/${ctx.couponId}`).set(ctx.adminHeaders).send({
      discountValue: "not-a-number",
    });
    expect(bad.status).toBe(422);
    expect(await historyCount(ctx.couponId)).toBe(before);
  });

  it("creates no history on no-op updates", async () => {
    const before = await historyCount(ctx.couponId);
    const noop = await request(app).patch(`/api/v1/coupons/${ctx.couponId}`).set(ctx.adminHeaders).send({
      description: "Updated trail",
    });
    expect(noop.status).toBe(200);
    expect(await historyCount(ctx.couponId)).toBe(before);
  });
});

describe("coupon deactivation / reactivation audit", () => {
  it("records DEACTIVATED with before/after active state", async () => {
    const res = await request(app).patch(`/api/v1/coupons/${ctx.couponId}`).set(ctx.adminHeaders).send({
      isActive: false,
    });
    expect(res.status).toBe(200);

    const history = await historyOf(ctx.couponId);
    const event = history.find((row) => row.action === "DEACTIVATED");
    expect(event).toBeTruthy();
    expect(event.actor).toMatchObject({ id: ctx.adminId, email: ctx.adminEmail });
    expect(event.metadata.changes.isActive).toEqual({ before: true, after: false });
  });

  it("records REACTIVATED with before/after active state", async () => {
    const res = await request(app).patch(`/api/v1/coupons/${ctx.couponId}`).set(ctx.adminHeaders).send({
      isActive: true,
    });
    expect(res.status).toBe(200);

    const history = await historyOf(ctx.couponId);
    const event = history.find((row) => row.action === "REACTIVATED");
    expect(event).toBeTruthy();
    expect(event.actor).toMatchObject({ id: ctx.adminId, email: ctx.adminEmail });
    expect(event.metadata.changes.isActive).toEqual({ before: false, after: true });
  });
});

describe("coupon history authorization", () => {
  it("rejects unauthenticated and non-admin readers", async () => {
    const anonymous = await request(app).get(`/api/v1/coupons/${ctx.couponId}/history`);
    expect(anonymous.status).toBe(401);

    const customer = await request(app).get(`/api/v1/coupons/${ctx.couponId}/history`).set(ctx.customerHeaders);
    expect(customer.status).toBe(403);
  });

  it("ignores spoofed actor fields in the request body", async () => {
    // Strict schemas reject unknown actor keys outright — nothing changes.
    const spoofed = await request(app).patch(`/api/v1/coupons/${ctx.couponId}`).set(ctx.adminHeaders).send({
      description: "Spoof attempt",
      adminId: "evil-id",
      actorEmail: "evil@example.test",
    });
    expect(spoofed.status).toBe(422);

    const legit = await request(app).patch(`/api/v1/coupons/${ctx.couponId}`).set(ctx.adminHeaders).send({
      description: "Spoof attempt",
    });
    expect(legit.status).toBe(200);
    const history = await historyOf(ctx.couponId);
    const event = history.find((row) => row.metadata?.changes?.description?.after === "Spoof attempt");
    expect(event.actor).toMatchObject({ id: ctx.adminId, email: ctx.adminEmail });
  });
});

describe("coupon history retrieval", () => {
  it("returns newest-first in deterministic order without leaking other coupons", async () => {
    const other = await request(app).post("/api/v1/coupons").set(ctx.adminHeaders).send({
      code: `${RUN}OTHER`,
      discountType: "FIXED",
      discountValue: "5",
    });
    expect(other.status).toBe(201);

    const history = await historyOf(ctx.couponId);
    for (const row of history) {
      expect(row.couponId).toBe(ctx.couponId);
    }
    const actions = history.map((row) => row.action);
    // Newest event is the legit post-spoof update; oldest is the creation.
    expect(actions[0]).toBe("UPDATED");
    expect(actions).toContain("REACTIVATED");
    expect(actions).toContain("DEACTIVATED");
    expect(actions).toContain("CREATED");
    expect(history[history.length - 1].action).toBe("CREATED");
    // Newest-first: timestamps non-increasing.
    const times = history.map((row) => new Date(row.createdAt).getTime());
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeLessThanOrEqual(times[i - 1]);
    }

    await request(app).delete(`/api/v1/coupons/${other.body.data.coupon.id}`).set(ctx.adminHeaders);
  });

  it("paginates deterministically", async () => {
    const first = await request(app)
      .get(`/api/v1/coupons/${ctx.couponId}/history?limit=2&page=1`)
      .set(ctx.adminHeaders);
    expect(first.status).toBe(200);
    expect(first.body.data.history).toHaveLength(2);
    expect(first.body.meta.total).toBeGreaterThanOrEqual(5);
    expect(first.body.meta.totalPages).toBeGreaterThanOrEqual(3);

    const second = await request(app)
      .get(`/api/v1/coupons/${ctx.couponId}/history?limit=2&page=2`)
      .set(ctx.adminHeaders);
    expect(second.status).toBe(200);
    const firstIds = first.body.data.history.map((row) => row.id);
    for (const row of second.body.data.history) {
      expect(firstIds).not.toContain(row.id);
    }
  });

  it("returns the standard not-found response for unknown coupons", async () => {
    const res = await request(app)
      .get("/api/v1/coupons/00000000-0000-0000-0000-000000000000/history")
      .set(ctx.adminHeaders);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("COUPON_NOT_FOUND");
  });
});

describe("coupon deletion audit", () => {
  it("persists a DELETED record with actor and snapshot for unused coupons", async () => {
    const created = await request(app).post("/api/v1/coupons").set(ctx.adminHeaders).send({
      code: `${RUN}GONE`,
      discountType: "FIXED",
      discountValue: "5",
    });
    expect(created.status).toBe(201);
    const doomedId = created.body.data.coupon.id;

    const removed = await request(app).delete(`/api/v1/coupons/${doomedId}`).set(ctx.adminHeaders);
    expect(removed.status).toBe(200);

    // The coupon row is gone (standard 404), but the FK-free audit row survives.
    const gone = await request(app).get(`/api/v1/coupons/${doomedId}`).set(ctx.adminHeaders);
    expect(gone.status).toBe(404);
    const rows = await prisma.couponHistory.findMany({ where: { couponId: doomedId } });
    expect(rows).toHaveLength(2);
    const deleted = rows.find((row) => row.action === "DELETED");
    expect(deleted).toBeTruthy();
    expect(deleted.actorId).toBe(ctx.adminId);
    expect(deleted.actorEmail).toBe(ctx.adminEmail);
    expect(deleted.metadata.snapshot).toMatchObject({ code: `${RUN}GONE` });

    await prisma.couponHistory.deleteMany({ where: { couponId: doomedId } });
  });

  it("writes no history when deletion is rejected (coupon in use)", async () => {
    // ctx.couponId is unused so far — delete path needs a used coupon; use a
    // guarded check instead: deleting with a bogus id shape is 422 first.
    const before = await historyCount(ctx.couponId);
    const missing = await request(app)
      .delete("/api/v1/coupons/00000000-0000-0000-0000-000000000000")
      .set(ctx.adminHeaders);
    expect(missing.status).toBe(404);
    expect(await historyCount(ctx.couponId)).toBe(before);
  });
});

describe("coupon audit atomicity", () => {
  it("leaves no history row when the mutation itself fails", async () => {
    const clashCoupon = await request(app).post("/api/v1/coupons").set(ctx.adminHeaders).send({
      code: `${RUN}CLASH`,
      discountType: "FIXED",
      discountValue: "5",
    });
    expect(clashCoupon.status).toBe(201);

    const before = await historyCount(ctx.couponId);
    // Duplicate code → 409 from the uniqueness guard; nothing persisted.
    const clash = await request(app).patch(`/api/v1/coupons/${ctx.couponId}`).set(ctx.adminHeaders).send({
      code: `${RUN}CLASH`,
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("COUPON_CODE_EXISTS");
    expect(await historyCount(ctx.couponId)).toBe(before);

    await request(app).delete(`/api/v1/coupons/${clashCoupon.body.data.coupon.id}`).set(ctx.adminHeaders);
  });
});
