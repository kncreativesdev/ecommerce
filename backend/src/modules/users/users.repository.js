const { prisma } = require("../../config/database");
const auditRepository = require("../audit/audit.repository");

const USER_PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
  roles: { include: { role: { select: { name: true } } } },
};

async function findUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: USER_PROFILE_SELECT,
  });
}

async function updateUserProfile(id, data) {
  return prisma.user.update({
    where: { id },
    data,
    select: USER_PROFILE_SELECT,
  });
}

/**
 * Admin user list. Every filter is explicit — callers pass a normalized
 * filter object (service layer), never raw query params. No ownership
 * predicate: ADMIN authorization is enforced by route middleware. The
 * safe select never exposes password hashes or tokens.
 */
/**
 * Phase 2C-5 company scoping: the company predicate leads the AND
 * chain, so the search OR-conditions (nested inside a single AND
 * member) can never escape it. An ADMIN sees only their own company's
 * users across search, active-state, pagination, and sorting.
 */
async function findUsersAdmin(filters) {
  const { companyId, search, isActive, role, sortBy, sortOrder, skip, take } = filters;

  const and = [{ companyId }];
  if (isActive !== null && isActive !== undefined) {
    and.push({ isActive });
  }
  // Phase 2C-31 HEAD scoping: an explicit role predicate (forced to
  // MEMBER for HEAD callers by the service) AND'd into the same chain
  // as the company predicate, so role filtering can never escape it.
  if (role !== null && role !== undefined) {
    and.push({ roles: { some: { role: { name: role } } } });
  }
  if (search) {
    and.push({
      OR: [
        { email: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
      ],
    });
  }

  const where = and.length > 0 ? { AND: and } : {};
  const orderBy = sortBy === "createdAt" ? [{ createdAt: sortOrder }] : [{ createdAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy,
      skip,
      take,
      select: USER_PROFILE_SELECT,
    }),
    prisma.user.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Global email lookup for first-SUPER_ADMIN bootstrap idempotency and
 * type guards. Returns every row carrying the normalized email (any
 * company, any role) with the safe profile select (roles included, no
 * hashes/tokens beyond the select's own fields). Callers classify via
 * `toSafeUser` — this finder never filters by role itself.
 */
async function findUsersByEmail(email) {
  return prisma.user.findMany({
    where: { email },
    orderBy: [{ createdAt: "asc" }],
    select: USER_PROFILE_SELECT,
  });
}

async function setUserActive(id, isActive) {
  return prisma.user.update({
    where: { id },
    data: { isActive },
    select: USER_PROFILE_SELECT,
  });
}

async function findUserByIdAndCompany(id, companyId) {
  return prisma.user.findFirst({
    where: { id, companyId },
    select: USER_PROFILE_SELECT,
  });
}

/**
 * Phase 2C-26 staff-identity invariant probe. Staff emails stay
 * globally unique (at most one user row per normalized email across
 * all companies and platform identities) so staff login and audit
 * attribution stay deterministic now that customers may share
 * emails across companies. Every staff creation path checks this
 * before inserting; the P2002 mapping at the call sites remains as
 * the race backstop.
 */
async function emailUsedAnywhere(email) {
  const row = await prisma.user.findFirst({
    where: { email },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Company-aware employee creation (Phase 2B-1 provisioning foundation).
 * `companyId` comes exclusively from the service caller (the creator's
 * server-resolved company or the internal provisioning operation) —
 * never from request input. Role rows are found-or-created like the
 * auth repository's equivalent; Prisma P2002/P2025 errors propagate
 * for the service layer to map.
 */
async function createUserWithCompanyRole(input, roleName, audit = null) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
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

    // Phase 2C-17: optional employee-provisioning audit (pre-validated
    // by the service) rides the same transaction — a rolled-back create
    // leaves no audit row behind.
    if (audit) {
      await auditRepository.createAuditEvent(
        { ...audit, companyId: input.companyId ?? null, resource: "USER", resourceId: user.id },
        tx
      );
    }

    return tx.user.findUniqueOrThrow({
      where: { id: user.id },
      select: USER_PROFILE_SELECT,
    });
  });
}

/**
 * Company row projection for ADMIN provisioning pre-checks. Lives here
 * (rather than a companies module, which does not exist yet) because
 * ADMIN provisioning owns both sides of the Company.adminUserId link.
 */
async function findCompanyForProvisioning(companyId) {
  return prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, adminUserId: true },
  });
}

/**
 * Atomic ADMIN provisioning: creates the ADMIN user (stamped with the
 * target company) and links it as Company.adminUserId in one
 * transaction. The UNIQUE constraint on companies.admin_user_id is the
 * race guard for concurrent provisioning — the service maps its P2002
 * to a 409. P2025 (company vanished mid-transaction) propagates.
 */
/**
 * Phase 2C-14: optional `audit` payload (pre-validated by the service)
 * is written with the SAME transaction client, so a rolled-back
 * provisioning leaves no audit row behind. The payload carries the
 * provisioned user's id once known — the service stamps resourceId
 * after the user create by passing a function.
 */
async function provisionCompanyAdminTx(companyId, userData, audit) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: userData.email,
        passwordHash: userData.passwordHash,
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone,
        companyId,
      },
    });

    let role = await tx.role.findUnique({ where: { name: "ADMIN" } });
    if (!role) {
      try {
        role = await tx.role.create({ data: { name: "ADMIN" } });
      } catch (err) {
        if (err.code !== "P2002") {
          throw err;
        }
        role = await tx.role.findUniqueOrThrow({ where: { name: "ADMIN" } });
      }
    }

    await tx.userRole.create({
      data: { userId: user.id, roleId: role.id },
    });

    await tx.company.update({
      where: { id: companyId },
      data: { adminUserId: user.id },
    });

    // In-transaction audit event (Phase 2C-14): `audit` carries the
    // service-validated actor snapshot; resource identity comes from
    // the row just created. Any failure below rolls the row back with
    // it — no orphan success records.
    if (audit) {
      await auditRepository.createAuditEvent(
        {
          ...audit,
          companyId,
          resource: "USER",
          resourceId: user.id,
        },
        tx
      );
    }

    return tx.user.findUniqueOrThrow({
      where: { id: user.id },
      select: USER_PROFILE_SELECT,
    });
  });
}

/**
 * Phase 2C-16 platform credential rotation (SUPER_ADMIN reset of a
 * company's designated ADMIN): sets the new Argon2id hash plus the
 * refresh-invalidation watermark and records the audit event in one
 * transaction. Creates nothing, reassigns nothing, touches no roles —
 * the exactly-one-ADMIN link is only read here, never written.
 */
async function resetUserPasswordTx({ userId, companyId, passwordHash, passwordChangedAt, audit }) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt },
      select: USER_PROFILE_SELECT,
    });
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, companyId, resource: "USER", resourceId: user.id }, tx);
    }
    return user;
  });
}

module.exports = {
  findUserById,
  updateUserProfile,
  findUsersAdmin,
  findUsersByEmail,
  setUserActive,
  findUserByIdAndCompany,
  emailUsedAnywhere,
  createUserWithCompanyRole,
  findCompanyForProvisioning,
  provisionCompanyAdminTx,
  resetUserPasswordTx,
};
