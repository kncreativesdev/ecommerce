import { describe, it, expect, afterAll } from "vitest";

import { prisma } from "../../src/config/database.js";
import { hashPassword, verifyPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionSuperAdmin } from "../../src/modules/users/users.service.js";

/**
 * First-SUPER_ADMIN provisioning behavior (live HTTP-free service calls
 * against MySQL, following the repository's integration conventions:
 * RUN-scoped fixtures, created rows tracked and removed afterwards).
 *
 * Covers the operator CLI's service contract (`provisionSuperAdmin`):
 * creation shape, idempotency, type guards, password policy, role
 * representation, and the no-Company/no-domain guarantee. CLI gate and
 * input resolution are unit-covered in
 * tests/unit/super-admin-bootstrap.test.js (no CLI execution here, so
 * no stray rows can escape fixture tracking).
 */

const RUN = `TSTBS${Date.now().toString(36).toUpperCase()}`.toLowerCase();
const PASSWORD = "BootstrapTest123!";
const email = (tag) => `${RUN}-${tag}@example.test`;

const createdUserIds = [];

async function roleId(name) {
  const role = await prisma.role.findUnique({ where: { name } });
  if (!role) {
    throw new Error(`Role ${name} is missing (migrations/seeds not applied?)`);
  }
  return role.id;
}

async function userRoles(userId) {
  const links = await prisma.userRole.findMany({
    where: { userId },
    include: { role: { select: { name: true } } },
  });
  return links.map((link) => link.role.name).sort();
}

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { resource: "USER", resourceId: { in: createdUserIds } },
  });
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe("provisionSuperAdmin creation", () => {
  it("creates a platform-scoped SUPER_ADMIN with a working password", async () => {
    const companiesBefore = await prisma.company.count();
    const domainsBefore = await prisma.companyDomain.count();

    const { user, created } = await provisionSuperAdmin({ email: email("new"), password: PASSWORD });
    createdUserIds.push(user.id);

    expect(created).toBe(true);
    expect(user).toMatchObject({ email: email("new"), isActive: true });
    expect(user.roles).toEqual(["SUPER_ADMIN"]);
    expect(user).not.toHaveProperty("passwordHash");
    expect(await userRoles(user.id)).toEqual(["SUPER_ADMIN"]);

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.companyId).toBeNull();
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(await verifyPassword(stored.passwordHash, PASSWORD)).toBe(true);
    expect(await verifyPassword(stored.passwordHash, "WrongPassword123!")).toBe(false);

    // Audited in-transaction with safe metadata only.
    const events = await prisma.auditLog.findMany({ where: { resource: "USER", resourceId: user.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "CREATED", outcome: "SUCCESS", actorRole: "SYSTEM", companyId: null });
    expect(events[0].details).toMatchObject({ email: email("new"), role: "SUPER_ADMIN", via: "bootstrap" });
    expect(JSON.stringify(events[0])).not.toContain(PASSWORD);

    // Creates no Company and no CompanyDomain.
    expect(await prisma.company.count()).toBe(companiesBefore);
    expect(await prisma.companyDomain.count()).toBe(domainsBefore);
  });

  it("is idempotent for an existing active SUPER_ADMIN (no duplicate, no changes)", async () => {
    const first = await provisionSuperAdmin({ email: email("idem"), password: PASSWORD });
    createdUserIds.push(first.user.id);
    expect(first.created).toBe(true);

    const auditBefore = await prisma.auditLog.count({ where: { resource: "USER", resourceId: first.user.id } });
    const second = await provisionSuperAdmin({ email: email("idem"), password: "ADifferentPassword123!" });
    expect(second).toMatchObject({ created: false });
    expect(second.user.id).toBe(first.user.id);

    const stored = await prisma.user.findUnique({ where: { id: first.user.id } });
    expect(await verifyPassword(stored.passwordHash, PASSWORD)).toBe(true);
    expect(await prisma.auditLog.count({ where: { resource: "USER", resourceId: first.user.id } })).toBe(auditBefore);
    expect(await prisma.user.count({ where: { email: email("idem") } })).toBe(1);
  });
});

describe("provisionSuperAdmin guards", () => {
  it("refuses an email held by a non-SUPER_ADMIN without elevation", async () => {
    const member = await prisma.user.create({
      data: { email: email("member"), passwordHash: await hashPassword(PASSWORD), firstName: "No", companyId: null },
    });
    createdUserIds.push(member.id);
    await prisma.userRole.create({ data: { userId: member.id, roleId: await roleId("MEMBER") } });

    await expect(provisionSuperAdmin({ email: email("member"), password: PASSWORD })).rejects.toMatchObject({
      statusCode: 409,
      code: "USER_EMAIL_EXISTS",
    });
    expect(await userRoles(member.id)).toEqual(["MEMBER"]);
  });

  it("refuses an inactive holder without reactivation (even an inactive SUPER_ADMIN)", async () => {
    const { user } = await provisionSuperAdmin({ email: email("off"), password: PASSWORD });
    createdUserIds.push(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    await expect(provisionSuperAdmin({ email: email("off"), password: PASSWORD })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.user.findUnique({ where: { id: user.id } })).isActive).toBe(false);
  });

  it("rejects malformed email and short passwords without touching the database", async () => {
    await expect(provisionSuperAdmin({ email: "not-an-email", password: PASSWORD })).rejects.toMatchObject({
      statusCode: 422,
      code: "USER_PROVISION_INVALID",
    });
    await expect(provisionSuperAdmin({ email: email("short"), password: "short" })).rejects.toMatchObject({
      statusCode: 422,
      code: "USER_PROVISION_INVALID",
    });
    expect(await prisma.user.count({ where: { email: email("short") } })).toBe(0);
  });
});

