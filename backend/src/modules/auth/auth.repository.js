const { prisma } = require("../../config/database");

const USER_WITH_ROLES = {
  roles: { include: { role: true } },
  // Phase 2C-13: login/refresh/Google gate on the owner's company
  // status. Selected, never serialized (toSafeUser picks explicit
  // fields), so session payloads and JWT claims are unchanged.
  company: { select: { status: true } },
};

async function findUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    include: USER_WITH_ROLES,
  });
}

/**
 * Phase 2C-26 company-scoped identity lookups. `User.email` is no
 * longer globally unique (same normalized email may exist in
 * different companies), so every email-keyed auth flow resolves
 * candidates instead of a single row:
 *
 * - `findUsersByEmail(email)` returns EVERY row carrying the
 *   normalized email (any company, any role), oldest first for
 *   determinism. The service partitions these into staff vs
 *   company/legacy candidates — callers must never treat the first
 *   row as the identity.
 * - `findUserByEmailAndCompany(email, companyId)` returns the single
 *   row for (company, email) or null. The compound unique guarantees
 *   at most one row, so domain-scoped flows are unambiguous.
 *
 * Both select the same session-gating shape as before (roles +
 * company status, never hashes/tokens in new fields — passwordHash
 * rides along only because login must verify it, exactly as before).
 */
async function findUsersByEmail(email) {
  return prisma.user.findMany({
    where: { email },
    orderBy: [{ createdAt: "asc" }],
    include: USER_WITH_ROLES,
  });
}

async function findUserByEmailAndCompany(email, companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    return null;
  }
  return prisma.user.findFirst({
    where: { email, companyId },
    include: USER_WITH_ROLES,
  });
}

async function createUserWithRole(input, roleName) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        // Phase 2C-11: server-resolved domain company for CUSTOMER
        // self-registration (null preserves legacy behavior). Never
        // client-supplied — services pass only resolved values.
        companyId: input.companyId ?? null,
      },
    });

    let role = await tx.role.findUnique({ where: { name: roleName } });
    if (!role) {
      try {
        role = await tx.role.create({ data: { name: roleName } });
      } catch (err) {
        if (err.code !== "P2002") {
          throw err;
        }
        role = await tx.role.findUniqueOrThrow({ where: { name: roleName } });
      }
    }

    await tx.userRole.create({
      data: { userId: user.id, roleId: role.id },
    });

    return tx.user.findUniqueOrThrow({
      where: { id: user.id },
      include: USER_WITH_ROLES,
    });
  });
}

/**
 * Refresh-session persistence (one-time rotation). Rows are keyed by
 * SHA-256 of the token `jti` — never the raw token — and carry only
 * ownership + lifetime metadata. All writes are conditional single
 * statements so concurrent consumers of the same `jti` serialize in
 * the database: exactly one wins.
 */
async function createRefreshSessionTx({ userId, jtiHash, expiresAt }, client) {
  const db = client || prisma;
  const now = new Date();
  return db.$transaction(async (tx) => {
    // Bounded hygiene: drop this user's dead rows (expired) whenever a
    // fresh session lands, so per-user row count stays proportional to
    // live sessions. Global expiry sweep runs on the retention tick.
    await tx.refreshSession.deleteMany({
      where: { userId, expiresAt: { lt: now } },
    });
    return tx.refreshSession.create({
      data: { userId, jtiHash, expiresAt },
      select: { id: true },
    });
  });
}

/**
 * Atomic one-time consumption. Revokes the row only when it is still
 * live (present, unrevoked, unexpired) and owned by `userId`.
 * Returns true for exactly one concurrent consumer; losers get false
 * and must fail the refresh with the neutral invalid-token error.
 */
async function consumeRefreshSession({ userId, jtiHash, now }) {
  const revoked = await prisma.refreshSession.updateMany({
    where: { jtiHash, userId, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now },
  });
  return revoked.count === 1;
}

/**
 * Logout revocation. Idempotent: missing or already-revoked rows
 * report success without error (logout stays 200 either way).
 */
async function revokeRefreshSession({ userId, jtiHash }) {
  await prisma.refreshSession.updateMany({
    where: { jtiHash, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Bounded global expiry sweep for the retention tick. Single indexed
 * range delete — no row hydration, safe to repeat.
 */
async function purgeExpiredRefreshSessions(now = new Date()) {
  const result = await prisma.refreshSession.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return result.count;
}
/**
 * Minimal projection for server-side company resolution (Phase 2A).
 * Read-only: user identity + database-authoritative role names + the
 * owned company row (id, name, status, adminUserId for the ADMIN
 * consistency check). Never returns password hashes or tokens.
 */
async function findUserWithCompanyContext(id) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      companyId: true,
      roles: { select: { role: { select: { name: true } } } },
      company: { select: { id: true, name: true, status: true, adminUserId: true } },
    },
  });
}

module.exports = {
  findUsersByEmail,
  findUserByEmailAndCompany,
  findUserById,
  createUserWithRole,
  findUserWithCompanyContext,
  createRefreshSessionTx,
  consumeRefreshSession,
  revokeRefreshSession,
  purgeExpiredRefreshSessions,
};
