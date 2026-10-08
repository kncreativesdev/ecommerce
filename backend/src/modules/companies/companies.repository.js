const { prisma } = require("../../config/database");
const auditRepository = require("../audit/audit.repository");

/**
 * Runtime domain resolution (Phase 2C-11).
 *
 * Looks up a registered hostname exactly as normalized (callers
 * normalize first — this function never normalizes). Only active
 * registrations resolve; the related company row rides along so the
 * middleware can attach identity without a second query. Unknown or
 * inactive domains yield null and the caller proceeds without context
 * (public behavior preserved, no existence oracle).
 */
async function findActiveDomainWithCompany(normalizedDomain) {
  return prisma.companyDomain.findFirst({
    where: { domain: normalizedDomain, isActive: true },
    select: {
      id: true,
      domain: true,
      isPrimary: true,
      company: {
        select: { id: true, name: true, status: true },
      },
    },
  });
}

const COMPANY_SELECT = {
  id: true,
  name: true,
  status: true,
  adminUserId: true,
  googleSignInEnabled: true,
  // Business profile (Phase 2C-33, all nullable). Selected everywhere
  // for the detail projection, but serialized only by
  // `toSafeCompanyDetail` — the list/summary mappers pick explicit
  // lean fields, so these never leak into lean shapes.
  contactEmail: true,
  contactPhone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  website: true,
  logoPath: true,
  createdAt: true,
  updatedAt: true,
};

const COMPANY_DETAIL_SELECT = {
  ...COMPANY_SELECT,
  domains: {
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true, domain: true, isPrimary: true, isActive: true },
  },
};

/**
 * Platform company list. Explicit filters only (service layer), never
 * raw query params. Returns management metadata plus structural
 * aggregate counts — never operational rows. The search OR is nested
 * inside a single AND member alongside the status predicate.
 */
async function findCompaniesAdmin({ search, status, skip, take }) {
  const and = [];
  if (status) {
    and.push({ status });
  }
  if (search) {
    and.push({ name: { contains: search } });
  }
  const where = and.length > 0 ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
      select: COMPANY_DETAIL_SELECT,
    }),
    prisma.company.count({ where }),
  ]);
  return { rows, total };
}

async function findCompanyById(id) {
  return prisma.company.findFirst({
    where: { id },
    select: COMPANY_DETAIL_SELECT,
  });
}

/**
 * Structural aggregate counts for the platform detail view. Counts
 * only — no user, order, product, or other operational rows leave the
 * database. Roles resolve through the UserRole join, orders through
 * their owning user.
 */
async function getCompanyAggregates(companyId) {
  const [
    totalUsers,
    totalCustomers,
    totalHeads,
    totalMembers,
    totalProducts,
    totalOrders,
  ] = await Promise.all([
    prisma.user.count({ where: { companyId } }),
    prisma.user.count({ where: { companyId, roles: { some: { role: { name: "CUSTOMER" } } } } }),
    prisma.user.count({ where: { companyId, roles: { some: { role: { name: "HEAD" } } } } }),
    prisma.user.count({ where: { companyId, roles: { some: { role: { name: "MEMBER" } } } } }),
    prisma.product.count({ where: { companyId } }),
    prisma.order.count({ where: { user: { companyId } } }),
  ]);
  return { totalUsers, totalCustomers, totalHeads, totalMembers, totalProducts, totalOrders };
}

/**
 * Bounded platform-wide aggregate counts (SUPER_ADMIN summary). Fixed
 * query count regardless of company count — no per-company fan-out:
 * status distribution via company groupBy; user/role and product
 * counts via grouped counts; order counts via a parameter-free grouped
 * join (no user input anywhere in the SQL). Counts only, never rows.
 */
async function getPlatformAggregateCounts() {
  const [statusGroups, userGroups, customerGroups, headGroups, memberGroups, productGroups, orderRows] =
    await Promise.all([
      prisma.company.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.user.groupBy({ by: ["companyId"], where: { companyId: { not: null } }, _count: { _all: true } }),
      prisma.user.groupBy({
        by: ["companyId"],
        where: { companyId: { not: null }, roles: { some: { role: { name: "CUSTOMER" } } } },
        _count: { _all: true },
      }),
      prisma.user.groupBy({
        by: ["companyId"],
        where: { companyId: { not: null }, roles: { some: { role: { name: "HEAD" } } } },
        _count: { _all: true },
      }),
      prisma.user.groupBy({
        by: ["companyId"],
        where: { companyId: { not: null }, roles: { some: { role: { name: "MEMBER" } } } },
        _count: { _all: true },
      }),
      prisma.product.groupBy({ by: ["companyId"], _count: { _all: true } }),
      prisma.$queryRawUnsafe(`
        SELECT u.company_id AS companyId, COUNT(*) AS orders
        FROM orders o
        JOIN users u ON u.id = o.user_id
        WHERE u.company_id IS NOT NULL
        GROUP BY u.company_id
      `),
    ]);
  const toMap = (groups) => {
    const map = new Map();
    for (const row of groups) {
      map.set(row.companyId, row._count._all);
    }
    return map;
  };
  const orderMap = new Map();
  for (const row of orderRows) {
    orderMap.set(row.companyId, Number(row.orders ?? 0));
  }
  return {
    statusGroups: statusGroups.map((row) => ({ status: row.status, count: row._count._all })),
    users: toMap(userGroups),
    customers: toMap(customerGroups),
    heads: toMap(headGroups),
    members: toMap(memberGroups),
    products: toMap(productGroups),
    orders: orderMap,
  };
}

async function createCompanyRecord(name, audit) {
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { name, status: "ACTIVE" },
      select: { id: true },
    });
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: company.id }, tx);
    }
    return tx.company.findUniqueOrThrow({
      where: { id: company.id },
      select: COMPANY_DETAIL_SELECT,
    });
  });
}

/**
 * Company metadata update. Single-row conditional write with the audit
 * row in the same transaction: a missing company reports "missing"
 * (service maps to 404); the audit commits only with the update. Only
 * the caller-supplied `data` keys are ever written — status,
 * adminUserId, and googleSignInEnabled move through their dedicated
 * endpoints and are unreachable here (strict validation rejects them
 * before this layer; `logoPath` is stamped by the logo endpoints only).
 */
async function updateCompanyRecordTx({ companyId, data, audit }) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!existing) {
      return { outcome: "missing" };
    }
    await tx.company.update({
      where: { id: companyId },
      data,
    });
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: companyId }, tx);
    }
    return { outcome: "ok" };
  });
}

/**
 * Company logo-path write (dedicated logo endpoints only). Same
 * transactional audit pattern as metadata updates: the file itself is
 * persisted before this transaction and the previous file is removed
 * only after it commits (service layer, warn-only).
 */
async function setCompanyLogoTx({ companyId, logoPath, audit }) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!existing) {
      return { outcome: "missing" };
    }
    await tx.company.update({
      where: { id: companyId },
      data: { logoPath },
    });
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: companyId }, tx);
    }
    return { outcome: "ok" };
  });
}

/**
 * Platform summary source rows (SUPER_ADMIN dashboard). Lean projection:
 * only the identity/metadata columns the dashboard contract requires
 * (id/name/status) plus the minimal domain fields needed to derive the
 * primary domain string. Profile columns, timestamps, and full detail
 * shapes stay on the detail/list endpoints — the summary never selects
 * them, so payload and serialization scale with company count alone.
 */
const COMPANY_SUMMARY_SELECT = {
  id: true,
  name: true,
  status: true,
  domains: {
    select: { domain: true, isPrimary: true },
  },
};

async function findAllCompaniesForSummary() {
  return prisma.company.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: COMPANY_SUMMARY_SELECT,
  });
}

/**
 * Guarded lifecycle transition: the conditional update is the
 * authority, so concurrent suspend/restore races serialize on the
 * expected-status predicate instead of double-applying. Returns the
 * current status on conflict so callers can answer deterministically
 * (already-suspended vs already-active). The audit row commits inside
 * the same transaction — a rolled-back transition leaves no record.
 */
async function transitionCompanyStatus(id, fromStatus, toStatus, audit) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.company.updateMany({
      where: { id, status: fromStatus },
      data: { status: toStatus },
    });
    if (updated.count === 0) {
      const current = await tx.company.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!current) {
        return { outcome: "missing" };
      }
      return { outcome: "conflict", status: current.status };
    }
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: id }, tx);
    }
    return { outcome: "ok" };
  });
}

/**
 * Pre-deletion guard projection (Phase 2C-20): identity, exact name,
 * and lifecycle state for the service's fail-before-destruction
 * checks. Read-only.
 */
async function findCompanyDeletionTarget(id) {
  return prisma.company.findUnique({
    where: { id },
    select: { id: true, name: true, status: true },
  });
}

/**
 * Media references owned by a company (Phase 2C-20): product image
 * storage paths, category image references, plus the company logo
 * path (Phase 2C-33). Collected BEFORE the destructive transaction so
 * post-commit filesystem cleanup knows exactly which bytes belonged to
 * the company. Database rows are removed inside the transaction; files
 * are removed after commit (warn-only — the DB is the source of truth).
 */
async function findCompanyMediaPaths(companyId) {
  const [images, categories, company] = await Promise.all([
    prisma.productImage.findMany({
      where: { product: { companyId } },
      select: { storagePath: true },
    }),
    prisma.category.findMany({
      where: { companyId, image: { not: null } },
      select: { image: true },
    }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { logoPath: true },
    }),
  ]);
  const paths = [
    ...images.map((row) => row.storagePath),
    ...categories.map((row) => row.image),
    company ? company.logoPath : null,
  ];
  return paths.filter((value) => typeof value === "string" && value !== "");
}

/**
 * Permanent company deletion (Phase 2C-20): removes EVERYTHING the
 * company owns in exact FK dependency order inside ONE transaction,
 * then deletes the company row itself with a guarded conditional
 * delete (id + still-SUSPENDED + same name). A concurrent restore —
 * or a racing second delete — matches zero rows at the final step,
 * which rolls the whole transaction back (outcome "missing",
 * nothing partially deleted).
 *
 * Dependency order (verified against prisma/schema.prisma):
 * reviews → coupon ids (for FK-free history) → inventory ledger →
 * inventory → product images → returns (history auto-cascades) →
 * order sub-rows + status history → orders → coupons (links
 * auto-cascade) + FK-free coupon history → users (roles, OTPs,
 * addresses, carts, wishlists, notifications, usages
 * auto-cascade) → variants → products → categories → broadcasts →
 * platform DELETED audit (companyId NULL, exempt from the company
 * cascade below) → company (domains + company audit rows
 * auto-cascade; adminUserId auto-nulls as its user goes).
 *
 * Global rows are never touched: Role records have no company
 * predicate here, SUPER_ADMIN users carry companyId NULL (outside
 * every user-scoped delete), and no other company's rows match.
 */
async function deleteCompanyCascadeTx({ id, name, audit }) {
  return prisma.$transaction(async (tx) => {
    await tx.review.deleteMany({
      where: { OR: [{ product: { companyId: id } }, { user: { companyId: id } }] },
    });

    const coupons = await tx.coupon.findMany({
      where: { companyId: id },
      select: { id: true },
    });
    const couponIds = coupons.map((row) => row.id);

    await tx.inventoryTransaction.deleteMany({
      where: { inventory: { variant: { companyId: id } } },
    });
    await tx.inventory.deleteMany({
      where: { variant: { companyId: id } },
    });

    await tx.productImage.deleteMany({
      where: { product: { companyId: id } },
    });

    await tx.returnRequest.deleteMany({
      where: { user: { companyId: id } },
    });

    const orders = await tx.order.findMany({
      where: { user: { companyId: id } },
      select: { id: true },
    });
    const orderIds = orders.map((row) => row.id);
    await tx.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });

    await tx.couponHistory.deleteMany({ where: { couponId: { in: couponIds } } });
    await tx.coupon.deleteMany({ where: { companyId: id } });

    await tx.user.deleteMany({ where: { companyId: id } });

    await tx.productVariant.deleteMany({ where: { companyId: id } });
    await tx.product.deleteMany({ where: { companyId: id } });
    await tx.category.deleteMany({ where: { companyId: id } });

    await tx.marketingNotification.deleteMany({ where: { companyId: id } });
    await tx.siteAnnouncement.deleteMany({ where: { companyId: id } });

    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: id }, tx);
    }

    const removed = await tx.company.deleteMany({
      where: { id, status: "SUSPENDED", name },
    });
    if (removed.count === 0) {
      return { outcome: "missing" };
    }
    return { outcome: "ok" };
  });
}

const COMPANY_DOMAIN_SELECT = {
  id: true,
  companyId: true,
  domain: true,
  isPrimary: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Domain registry reads (Phase 2C-27). Ordered primary-first so the
 * management list always surfaces the routing primary at the top.
 */
async function findCompanyDomains(companyId) {
  return prisma.companyDomain.findMany({
    where: { companyId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: COMPANY_DOMAIN_SELECT,
  });
}

async function findCompanyDomainById(domainId) {
  return prisma.companyDomain.findUnique({
    where: { id: domainId },
    select: COMPANY_DOMAIN_SELECT,
  });
}

async function findCompanyDomainByName(domain) {
  return prisma.companyDomain.findUnique({
    where: { domain },
    select: COMPANY_DOMAIN_SELECT,
  });
}

async function countCompanyDomains(companyId) {
  return prisma.companyDomain.count({ where: { companyId } });
}

/**
 * Domain registration (Phase 2C-27). The first domain of a company
 * becomes its primary inside the same transaction (the count and the
 * insert share one `tx`, so the exactly-one-primary invariant in
 * §R.1 holds for sequentially committed registrations); later
 * domains are secondary until promoted. The global `domain @unique`
 * stays the cross-company race guard — a conflicting insert surfaces
 * P2002 for the service to map. The audit row commits with the
 * insert — a rolled-back registration leaves no record.
 */
async function createCompanyDomainTx({ companyId, domain, audit }) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.companyDomain.count({ where: { companyId } });
    const row = await tx.companyDomain.create({
      data: { companyId, domain, isPrimary: existing === 0, isActive: true },
      select: COMPANY_DOMAIN_SELECT,
    });
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: row.id }, tx);
    }
    return { outcome: "ok", domain: row };
  });
}

/**
 * Domain state update (Phase 2C-27). Promotion (`isPrimary: true`)
 * demotes every sibling and promotes the target in ONE transaction,
 * so concurrent promotions serialize to exactly one primary
 * (last-writer-wins, never two). An optional `isActive` rides in the
 * same transaction. Demotion (`isPrimary: false`) is not expressed
 * here — the service rejects demoting a primary without promoting
 * another, and demoting a non-primary is a no-op handled above this
 * layer. Returns the fresh row; the audit row commits with it.
 */
async function promoteCompanyDomainTx({ companyId, domainId, isActive, audit }) {
  return prisma.$transaction(async (tx) => {
    if (isActive !== undefined) {
      await tx.companyDomain.update({
        where: { id: domainId },
        data: { isActive },
      });
    }
    await tx.companyDomain.updateMany({
      where: { companyId, id: { not: domainId }, isPrimary: true },
      data: { isPrimary: false },
    });
    const row = await tx.companyDomain.update({
      where: { id: domainId },
      data: { isPrimary: true },
      select: COMPANY_DOMAIN_SELECT,
    });
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: row.id }, tx);
    }
    return { outcome: "ok", domain: row };
  });
}

/**
 * Active-state toggle without primary movement (Phase 2C-27).
 * `isActive` is orthogonal to `isPrimary`: deactivating the primary
 * keeps its flag (reactivation restores routing with no promotion
 * needed). The audit row commits with the update.
 */
async function setCompanyDomainActiveTx({ domainId, isActive, audit }) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.companyDomain.update({
      where: { id: domainId },
      data: { isActive },
      select: COMPANY_DOMAIN_SELECT,
    });
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: row.id }, tx);
    }
    return { outcome: "ok", domain: row };
  });
}

/**
 * Domain removal (Phase 2C-27). The primary guard lives inside the
 * transaction: deleting a primary while siblings exist reports
 * "primary-blocked" (the operator must promote another first);
 * deleting the sole domain is allowed (a company may hold zero
 * domains — Company #1 is the precedent). The audit row commits with
 * the delete. Domain removal never touches the company row or any
 * operational data.
 */
async function deleteCompanyDomainTx({ companyId, domainId, audit }) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.companyDomain.findUnique({
      where: { id: domainId },
      select: COMPANY_DOMAIN_SELECT,
    });
    if (!row || row.companyId !== companyId) {
      return { outcome: "missing" };
    }
    if (row.isPrimary) {
      const total = await tx.companyDomain.count({ where: { companyId } });
      if (total > 1) {
        return { outcome: "primary-blocked" };
      }
    }
    await tx.companyDomain.delete({ where: { id: domainId } });
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: domainId }, tx);
    }
    return { outcome: "ok", domain: row };
  });
}

/**
 * Google allowlist read for the auth flow (Phase 4-4). Minimal
 * projection (flag only); null when the company does not exist, which
 * the service treats as fail-closed.
 */
async function findCompanyGoogleSignIn(companyId) {
  return prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, googleSignInEnabled: true },
  });
}

/**
 * Google sign-in allowlist update (Phase 4-4). Single-row conditional
 * write inside one transaction with the audit row: a missing company
 * reports "missing" (service maps to 404); the audit commits only
 * with the update.
 */
async function setGoogleSignInTx({ companyId, enabled, audit }) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!existing) {
      return { outcome: "missing" };
    }
    const row = await tx.company.update({
      where: { id: companyId },
      data: { googleSignInEnabled: enabled },
      select: COMPANY_SELECT,
    });
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: row.id }, tx);
    }
    return { outcome: "ok", company: row };
  });
}

module.exports = {
  findActiveDomainWithCompany,
  findCompaniesAdmin,
  findCompanyById,
  findCompanyDeletionTarget,
  findCompanyMediaPaths,
  getCompanyAggregates,
  getPlatformAggregateCounts,
  createCompanyRecord,
  updateCompanyRecordTx,
  setCompanyLogoTx,
  findAllCompaniesForSummary,
  transitionCompanyStatus,
  deleteCompanyCascadeTx,
  findCompanyDomains,
  findCompanyDomainById,
  findCompanyDomainByName,
  countCompanyDomains,
  createCompanyDomainTx,
  promoteCompanyDomainTx,
  setCompanyDomainActiveTx,
  deleteCompanyDomainTx,
  setGoogleSignInTx,
  findCompanyGoogleSignIn,
};
