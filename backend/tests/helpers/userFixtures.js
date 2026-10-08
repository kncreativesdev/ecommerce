/**
 * Company-aware user fixture helpers (Phase 2B-1).
 *
 * The shared database's pre-existing data belongs to Company #1, so
 * real role-bearing fixture users are stamped with it via these
 * test-only helpers (test setup is trusted server-side code — this is
 * not a client input path). Tests that deliberately need a null or
 * dangling companyId (company-context boundary tests) must NOT use
 * these helpers.
 */

import { prisma } from "../../src/config/database.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const COMPANY_ONE_ID = "35b5a215-0cf3-42db-ba42-6fac6656a708";

/**
 * Stamps an existing fixture user with a company. Returns the updated id.
 */
async function stampUserCompany(userId, companyId = COMPANY_ONE_ID) {
  await prisma.user.update({ where: { id: userId }, data: { companyId } });
  return userId;
}

let cachedCompanyOneAdminId = null;

/**
 * Company #1's provisioned ADMIN id (read-only lookup, cached per
 * worker). Fixture ADMIN headers use this instead of synthetic
 * identities such as "admin-test" so mounted companyContext resolves
 * them. Throws when the association is missing rather than guessing.
 */
async function companyOneAdminId() {
  if (!cachedCompanyOneAdminId) {
    const company = await prisma.company.findUnique({
      where: { id: COMPANY_ONE_ID },
      select: { adminUserId: true },
    });
    if (!company || !company.adminUserId) {
      throw new Error("Company #1 ADMIN is missing; cannot build fixture ADMIN identity");
    }
    cachedCompanyOneAdminId = company.adminUserId;
  }
  return cachedCompanyOneAdminId;
}

/**
 * Ready-to-use ADMIN Authorization header for Company #1 fixtures.
 */
async function companyOneAdminHeaders() {
  const id = await companyOneAdminId();
  return { Authorization: `Bearer ${signAccessToken({ id, roles: ["ADMIN"] })}` };
}

export { COMPANY_ONE_ID, stampUserCompany, companyOneAdminId, companyOneAdminHeaders };
