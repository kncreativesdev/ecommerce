import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";

function tokenFor(roles) {
  return signAccessToken({ id: randomUUID(), roles });
}

const ADMIN_HEADERS = () => ({ Authorization: `Bearer ${tokenFor(["ADMIN"])}` });
const CUSTOMER_HEADERS = () => ({ Authorization: `Bearer ${tokenFor(["CUSTOMER"])}` });

function uniqueCode() {
  return `TST-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, "0")}`.slice(0, 20);
}

const createdIds = [];

async function cleanupCoupons() {
  const headers = ADMIN_HEADERS();
  for (const id of createdIds.splice(0)) {
    try {
      await request(app).delete(`/api/v1/coupons/${id}`).set(headers);
    } catch {
      // Best-effort: never fail the suite on cleanup.
    }
  }
}

afterEach(async () => {
  await cleanupCoupons();
});

describe("coupon admin authorization", () => {
  it("rejects unauthenticated list access with 401", async () => {
    const res = await request(app).get("/api/v1/coupons");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("rejects unauthenticated creation with 401", async () => {
    const res = await request(app)
      .post("/api/v1/coupons")
      .send({ code: "NOPE", discountType: "FIXED", discountValue: "5" });
    expect(res.status).toBe(401);
  });

  it("rejects customer-role list access with 403 without touching data", async () => {
    const res = await request(app).get("/api/v1/coupons").set(CUSTOMER_HEADERS());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("rejects customer-role creation with 403", async () => {
    const res = await request(app)
      .post("/api/v1/coupons")
      .set(CUSTOMER_HEADERS())
      .send({ code: "NOPE", discountType: "FIXED", discountValue: "5" });
    expect(res.status).toBe(403);
  });
});

describe("coupon admin validation (no writes)", () => {
  it("rejects an empty create body with 422", async () => {
    const res = await request(app).post("/api/v1/coupons").set(ADMIN_HEADERS()).send({});
    expect(res.status).toBe(422);
  });

  it("rejects unknown list scopes with 422", async () => {
    const res = await request(app).get("/api/v1/coupons?status=expired").set(ADMIN_HEADERS());
    expect(res.status).toBe(422);
  });

  it("returns 404 for an unknown coupon id", async () => {
    const res = await request(app).get(`/api/v1/coupons/${randomUUID()}`).set(ADMIN_HEADERS());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("COUPON_NOT_FOUND");
  });
});

describe("coupon admin CRUD round-trip (live MySQL)", () => {
  it("creates, reads, updates, deactivates, and deletes a coupon", async () => {
    const headers = ADMIN_HEADERS();
    const code = uniqueCode();

    const created = await request(app).post("/api/v1/coupons").set(headers).send({
      code,
      description: "integration test coupon",
      discountType: "PERCENTAGE",
      discountValue: "12.50",
      maximumDiscountAmount: "100.00",
      minimumOrderAmount: "50.00",
      usageLimit: 10,
      isActive: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.coupon.code).toBe(code);
    expect(created.body.data.coupon.usedCount).toBe(0);
    createdIds.push(created.body.data.coupon.id);
    const id = created.body.data.coupon.id;

    const listed = await request(app).get(`/api/v1/coupons?search=${code}`).set(headers);
    expect(listed.status).toBe(200);
    expect(listed.body.data.coupons.some((row) => row.id === id)).toBe(true);
    expect(listed.body.meta.total).toBeGreaterThanOrEqual(1);

    const detail = await request(app).get(`/api/v1/coupons/${id}`).set(headers);
    expect(detail.status).toBe(200);
    expect(detail.body.data.coupon.discountValue).toBe("12.50");

    const updated = await request(app).patch(`/api/v1/coupons/${id}`).set(headers).send({
      description: "edited",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.coupon.description).toBe("edited");

    const deactivated = await request(app).patch(`/api/v1/coupons/${id}`).set(headers).send({
      isActive: false,
    });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.coupon.isActive).toBe(false);

    const removed = await request(app).delete(`/api/v1/coupons/${id}`).set(headers);
    expect(removed.status).toBe(200);
    createdIds.pop();

    const gone = await request(app).get(`/api/v1/coupons/${id}`).set(headers);
    expect(gone.status).toBe(404);
  });

  it("rejects a duplicate code with the documented conflict", async () => {
    const headers = ADMIN_HEADERS();
    const code = uniqueCode();

    const first = await request(app)
      .post("/api/v1/coupons")
      .set(headers)
      .send({ code, discountType: "FIXED", discountValue: "5" });
    expect(first.status).toBe(201);
    createdIds.push(first.body.data.coupon.id);

    const second = await request(app)
      .post("/api/v1/coupons")
      .set(headers)
      .send({ code, discountType: "FIXED", discountValue: "5" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("COUPON_CODE_EXISTS");
  });

  it("rejects invalid discount semantics and date windows with 422", async () => {
    const headers = ADMIN_HEADERS();

    const percent = await request(app)
      .post("/api/v1/coupons")
      .set(headers)
      .send({ code: uniqueCode(), discountType: "PERCENTAGE", discountValue: "150" });
    expect(percent.status).toBe(422);
    expect(percent.body.error.code).toBe("COUPON_INVALID_DISCOUNT");

    const dates = await request(app)
      .post("/api/v1/coupons")
      .set(headers)
      .send({
        code: uniqueCode(),
        discountType: "FIXED",
        discountValue: "5",
        startsAt: "2026-09-10T00:00:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
      });
    expect(dates.status).toBe(422);
  });

  it("rejects empty updates and protects used coupons from deletion", async () => {
    const headers = ADMIN_HEADERS();
    const code = uniqueCode();

    const created = await request(app)
      .post("/api/v1/coupons")
      .set(headers)
      .send({ code, discountType: "FIXED", discountValue: "5" });
    expect(created.status).toBe(201);
    const id = created.body.data.coupon.id;
    createdIds.push(id);

    const empty = await request(app).patch(`/api/v1/coupons/${id}`).set(headers).send({});
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe("COUPON_UPDATE_INVALID");

    // Simulate real usage (usage counting has no HTTP surface yet) then
    // verify the documented delete guard; restore afterwards for cleanup.
    await prisma.coupon.update({ where: { id }, data: { usedCount: { increment: 2 } } });
    const guarded = await request(app).delete(`/api/v1/coupons/${id}`).set(headers);
    expect(guarded.status).toBe(409);
    expect(guarded.body.error.code).toBe("COUPON_IN_USE");
    await prisma.coupon.update({ where: { id }, data: { usedCount: 0 } });
  });
});
