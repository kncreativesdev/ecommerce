import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword, verifyPassword } from "../../src/modules/auth/auth.utils.js";
import { getTestOutbox, clearTestOutbox } from "../../src/config/mailer.js";

/**
 * Phase 2C-16 forgot-password OTP flow (live HTTP).
 *
 * Initiation never reveals account existence (same 200 either way);
 * codes are Argon2id-hashed, short-lived, single-use, attempt-bounded.
 * Company #1 is untouched (fixtures carry no company).
 */

const RUN = `TSTPR${Date.now().toString(36).toUpperCase()}`.toLowerCase();

const createdUserIds = [];
const mailFor = (email) => getTestOutbox().filter((m) => m.to === email);
const otpFrom = (mail) => {
  const match = /(\d{6})/.exec(mail.text);
  expect(match).not.toBeNull();
  return match[1];
};

async function createCustomer(tag) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "Reset",
      lastName: tag,
      companyId: null,
    },
  });
  createdUserIds.push(user.id);
  const role = await prisma.role.findUnique({ where: { name: "CUSTOMER" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function forgot(email, extra = {}) {
  return request(app).post("/api/v1/auth/forgot-password").send({ email, ...extra });
}

beforeAll(async () => {
  clearTestOutbox();
  await createCustomer("owner");
  await createCustomer("expired");
  await createCustomer("reused");
  await createCustomer("bounded");
}, 120000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ resourceId: { in: createdUserIds } }, { actorId: { in: createdUserIds } }],
    },
  });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("forgot-password initiation", () => {
  it("answers existing accounts with the uniform message and sends mail", async () => {
    const res = await forgot(`${RUN}-owner@example.test`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      message: "If an account exists for this email, a verification code has been sent.",
    });
    expect(mailFor(`${RUN}-owner@example.test`)).toHaveLength(1);
  });

  it("answers nonexistent emails identically without sending mail", async () => {
    const before = getTestOutbox().length;
    const res = await forgot(`${RUN}-nobody-here@example.test`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      message: "If an account exists for this email, a verification code has been sent.",
    });
    expect(getTestOutbox()).toHaveLength(before);
  });

  it("stores only the OTP hash, never the code", async () => {
    const user = await createCustomer("hashed");
    await forgot(user.email);
    const row = await prisma.passwordOtp.findFirst({
      where: { userId: user.id, purpose: "PASSWORD_RESET" },
      orderBy: [{ createdAt: "desc" }],
    });
    expect(row).not.toBeNull();
    const code = otpFrom(mailFor(user.email).at(-1));
    expect(row.otpHash).not.toContain(code);
    expect(await verifyPassword(row.otpHash, code)).toBe(true);
  });

  it("email carries the code and expiry, nothing internal", async () => {
    const mail = mailFor(`${RUN}-owner@example.test`).at(-1);
    expect(mail.subject).toMatch(/reset code/i);
    expect(mail.text).toContain(otpFrom(mail));
    expect(mail.text).toMatch(/10 minutes/);
    expect(mail.text).not.toMatch(/passwordHash|refresh|Bearer|eyJ[A-Za-z0-9_-]+\.eyJ/);
    expect(JSON.stringify(mail)).not.toMatch(/companyId|passwordOtp|password_otps/);
  });
});

describe("OTP verification", () => {
  it("accepts a valid code", async () => {
    const user = await createCustomer("verify-ok");
    await forgot(user.email);
    const code = otpFrom(mailFor(user.email).at(-1));
    const res = await request(app).post("/api/v1/auth/verify-reset-otp").send({ email: user.email, otp: code });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ verified: true });
  });

  it("rejects wrong codes without consuming the live one", async () => {
    const user = await createCustomer("verify-bad");
    await forgot(user.email);
    const code = otpFrom(mailFor(user.email).at(-1));
    for (const wrong of ["000000", "999999"]) {
      const res = await request(app).post("/api/v1/auth/verify-reset-otp").send({ email: user.email, otp: wrong });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AUTH_OTP_INVALID");
    }
    const res = await request(app).post("/api/v1/auth/verify-reset-otp").send({ email: user.email, otp: code });
    expect(res.status).toBe(200);
  });

  it("rejects expired codes", async () => {
    const email = `${RUN}-expired@example.test`;
    await forgot(email);
    const code = otpFrom(mailFor(email).at(-1));
    const user = await prisma.user.findFirst({ where: { email } });
    await prisma.passwordOtp.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 60 * 1000) },
    });
    const res = await request(app).post("/api/v1/auth/verify-reset-otp").send({ email, otp: code });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("AUTH_OTP_INVALID");
  });

  it("rejects reused codes after a completed reset", async () => {
    const email = `${RUN}-reused@example.test`;
    await forgot(email);
    const code = otpFrom(mailFor(email).at(-1));
    await request(app).post("/api/v1/auth/verify-reset-otp").send({ email, otp: code });
    const done = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ email, otp: code, newPassword: "ReusedNew123!" });
    expect(done.status).toBe(200);
    const again = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ email, otp: code, newPassword: "ReusedNew123!" });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("AUTH_OTP_INVALID");
  });

  it("bounds incorrect attempts: five wrong tries kill the code", async () => {
    const email = `${RUN}-bounded@example.test`;
    await forgot(email);
    const code = otpFrom(mailFor(email).at(-1));
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post("/api/v1/auth/verify-reset-otp").send({ email, otp: "000000" });
      expect(res.status).toBe(400);
    }
    const res = await request(app).post("/api/v1/auth/verify-reset-otp").send({ email, otp: code });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("AUTH_OTP_INVALID");
  });
});

describe("company safety", () => {
  it("query/header companyId tricks are ignored", async () => {
    const email = `${RUN}-owner@example.test`;
    const before = mailFor(email).length;
    const res = await request(app)
      .post("/api/v1/auth/forgot-password?companyId=11111111-1111-1111-1111-111111111111")
      .set("x-company-id", "11111111-1111-1111-1111-111111111111")
      .send({ email });
    expect(res.status).toBe(200);
    expect(mailFor(email)).toHaveLength(before + 1);
  });

  it("body companyId keeps the platform strict-validation contract", async () => {
    const res = await forgot(`${RUN}-owner@example.test`, { companyId: "11111111-1111-1111-1111-111111111111" });
    expect(res.status).toBe(422);
  });
});
