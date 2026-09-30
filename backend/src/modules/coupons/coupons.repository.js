const { prisma } = require("../../config/database");
const { toAuditSnapshot } = require("./coupons.utils");

const COUPON_SELECT = {
  id: true,
  code: true,
  description: true,
  discountType: true,
  discountValue: true,
  minimumOrderAmount: true,
  maximumDiscountAmount: true,
  usageLimit: true,
  usedCount: true,
  startsAt: true,
  expiresAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  products: {
    select: { productId: true },
  },
};

async function findCouponByCode(code) {
  return prisma.coupon.findUnique({
    where: { code },
    select: COUPON_SELECT,
  });
}

async function findCouponById(id) {
  return prisma.coupon.findUnique({
    where: { id },
    select: COUPON_SELECT,
  });
}

/**
 * Admin coupon list. Explicit filters only (service passes a normalized
 * object, never raw query params). Default scope is ALL — an ADMIN-only
 * endpoint has no public default to preserve, and inactive/expired rows
 * must stay discoverable.
 */
async function findCouponsAdmin(filters) {
  const { status, search, skip, take } = filters;

  const and = [];
  if (status === "active") {
    and.push({ isActive: true });
  } else if (status === "inactive") {
    and.push({ isActive: false });
  }
  if (search) {
    and.push({
      OR: [{ code: { contains: search } }, { description: { contains: search } }],
    });
  }

  const where = and.length > 0 ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
      select: COUPON_SELECT,
    }),
    prisma.coupon.count({ where }),
  ]);
  return { rows, total };
}

async function findExistingProductIds(ids) {
  if (!ids || ids.length === 0) {
    return [];
  }
  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Append-only admin audit write. Always called on a coupon-mutation
 * transaction client so the history row commits or rolls back WITH the
 * mutation — never fire-and-forget. The actor email is snapshotted here
 * (same transaction) so the record stays readable even if the admin is
 * later deleted (no hard FK, same convention as OrderStatusHistory).
 */
async function writeHistoryTx(tx, { couponId, actorId, action, metadata }) {
  let actorEmail = null;
  if (actorId) {
    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: { email: true },
    });
    actorEmail = actor ? actor.email : null;
  }
  await tx.couponHistory.create({
    data: {
      couponId,
      actorId: actorId ?? null,
      actorEmail,
      action,
      metadata: metadata ?? null,
    },
    select: { id: true },
  });
}

async function createCouponRecord(data, productIds, audit) {
  return prisma.$transaction(async (tx) => {
    const coupon = await tx.coupon.create({
      data,
      select: { id: true },
    });
    if (productIds && productIds.length > 0) {
      await tx.couponProduct.createMany({
        data: productIds.map((productId) => ({ couponId: coupon.id, productId })),
      });
    }
    if (audit) {
      await writeHistoryTx(tx, { couponId: coupon.id, ...audit });
    }
    return coupon.id;
  });
}

async function updateCouponRecord(id, data, productIds, audit) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.coupon.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return { outcome: "missing" };
    }
    if (Object.keys(data).length > 0) {
      await tx.coupon.update({ where: { id }, data });
    }
    if (productIds !== undefined) {
      await tx.couponProduct.deleteMany({ where: { couponId: id } });
      if (productIds.length > 0) {
        await tx.couponProduct.createMany({
          data: productIds.map((productId) => ({ couponId: id, productId })),
        });
      }
    }
    if (audit) {
      await writeHistoryTx(tx, { couponId: id, ...audit });
    }
    return { outcome: "ok" };
  });
}

async function deleteCouponRecord(id, audit) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.coupon.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        description: true,
        discountType: true,
        discountValue: true,
        minimumOrderAmount: true,
        maximumDiscountAmount: true,
        usageLimit: true,
        usedCount: true,
        startsAt: true,
        expiresAt: true,
        isActive: true,
        products: { select: { productId: true } },
      },
    });
    if (!existing) {
      return { outcome: "missing" };
    }
    if (existing.usedCount > 0) {
      return { outcome: "in-use", usedCount: existing.usedCount };
    }
    // Product links cascade via FK; orders never reference coupons, so no
    // historical discount data is affected. The audit row is written BEFORE
    // the delete in the same transaction; the history table is FK-free so
    // the DELETED record survives the coupon row.
    if (audit) {
      await writeHistoryTx(tx, {
        couponId: id,
        actorId: audit.actorId,
        action: audit.action,
        metadata: { snapshot: toAuditSnapshot(existing) },
      });
    }
    await tx.coupon.delete({ where: { id } });
    return { outcome: "ok" };
  });
}

const COUPON_HISTORY_SELECT = {
  id: true,
  couponId: true,
  actorId: true,
  actorEmail: true,
  action: true,
  metadata: true,
  createdAt: true,
};

async function findCouponHistory(couponId, { skip, take }) {
  return prisma.couponHistory.findMany({
    where: { couponId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: COUPON_HISTORY_SELECT,
  });
}

async function countCouponHistory(couponId) {
  return prisma.couponHistory.count({ where: { couponId } });
}

async function findUsageByCouponAndUser(couponId, userId) {
  return prisma.couponUsage.findUnique({
    where: { couponId_userId: { couponId, userId } },
    select: { id: true },
  });
}

async function tryConsumeUsage(couponId) {
  return consumeUsageWith(prisma, couponId);
}

/**
 * Transaction-aware usage consumption for checkout: the SAME guarded
 * increment, executed on the order transaction client so usage is only
 * ever consumed by a successfully committed order (failed orders roll
 * the increment back; concurrent checkouts race on the guarded
 * `usedCount < usageLimit` predicate instead of overshooting it).
 */
async function tryConsumeUsageTx(tx, couponId) {
  return consumeUsageWith(tx, couponId);
}

async function consumeUsageWith(client, couponId) {
  const coupon = await client.coupon.findUnique({
    where: { id: couponId },
    select: { id: true, usageLimit: true, usedCount: true },
  });
  if (!coupon) {
    return { outcome: "missing" };
  }
  if (coupon.usageLimit === null || coupon.usageLimit === undefined) {
    const updated = await client.coupon.update({
      where: { id: couponId },
      data: { usedCount: { increment: 1 } },
      select: { id: true, usedCount: true },
    });
    return { outcome: "ok", usedCount: updated.usedCount };
  }
  const result = await client.coupon.updateMany({
    where: { id: couponId, usedCount: { lt: coupon.usageLimit } },
    data: { usedCount: { increment: 1 } },
  });
  if (result.count === 0) {
    return { outcome: "exhausted" };
  }
  const updated = await client.coupon.findUniqueOrThrow({
    where: { id: couponId },
    select: { usedCount: true },
  });
  return { outcome: "ok", usedCount: updated.usedCount };
}

/**
 * One-time-per-customer ledger write for checkout: executed on the order
 * transaction client with the created order id, so usage exists only for
 * successfully committed orders. The UNIQUE (couponId, userId) pair is the
 * concurrency guard — a duplicate insert surfaces P2002, mapped here to
 * "already-used" so concurrent same-customer orders deterministically
 * leave at most one winner.
 */
async function recordUsageTx(tx, { couponId, userId, orderId }) {
  try {
    await tx.couponUsage.create({
      data: { couponId, userId, orderId },
      select: { id: true },
    });
    return { outcome: "ok" };
  } catch (err) {
    if (err.code === "P2002") {
      return { outcome: "already-used" };
    }
    throw err;
  }
}

module.exports = {
  findCouponByCode,
  findCouponById,
  findUsageByCouponAndUser,
  recordUsageTx,
  findCouponsAdmin,
  findExistingProductIds,
  createCouponRecord,
  updateCouponRecord,
  deleteCouponRecord,
  findCouponHistory,
  countCouponHistory,
  tryConsumeUsage,
  tryConsumeUsageTx,
};
