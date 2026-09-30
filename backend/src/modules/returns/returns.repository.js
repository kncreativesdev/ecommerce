const { prisma } = require("../../config/database");

const RETURN_SELECT = {
  id: true,
  orderId: true,
  userId: true,
  status: true,
  reason: true,
  details: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Owner-scoped order read for returns: missing rows and other customers'
 * orders are both null (callers map to 404 ORDER_NOT_FOUND, never
 * distinguished) — the same ownership convention as order detail reads.
 */
async function findOrderForReturn(orderId, userId) {
  return prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { id: true, userId: true, status: true, orderNumber: true },
  });
}

async function findReturnByOrderId(orderId) {
  return prisma.returnRequest.findUnique({
    where: { orderId },
    select: RETURN_SELECT,
  });
}

const ADMIN_RETURN_SELECT = {
  ...RETURN_SELECT,
  user: {
    select: { id: true, email: true, firstName: true, lastName: true, phone: true },
  },
  order: {
    select: { id: true, orderNumber: true, status: true, grandTotal: true, createdAt: true },
  },
};

const ADMIN_RETURN_DETAIL_SELECT = {
  ...ADMIN_RETURN_SELECT,
  history: {
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, actorId: true, createdAt: true },
  },
};

/**
 * Admin return list. Explicit filters only (service layer), never raw
 * query params. No ownership predicate: ADMIN authorization is enforced
 * by route middleware. Newest requests first.
 */
async function findReturnsAdmin({ status, search, skip, take }) {
  const and = [];
  if (status) {
    and.push({ status });
  }
  if (search) {
    and.push({
      OR: [
        { order: { orderNumber: { contains: search } } },
        { user: { email: { contains: search } } },
        { user: { firstName: { contains: search } } },
        { user: { lastName: { contains: search } } },
      ],
    });
  }
  const where = and.length > 0 ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
      select: ADMIN_RETURN_SELECT,
    }),
    prisma.returnRequest.count({ where }),
  ]);
  return { rows, total };
}

async function findReturnByIdAdmin(id) {
  return prisma.returnRequest.findUnique({
    where: { id },
    select: ADMIN_RETURN_DETAIL_SELECT,
  });
}

/**
 * Atomic return creation: request + initial REQUESTED history + customer
 * notification commit or roll back together. The UNIQUE(orderId) pair is
 * the duplicate-creation race guard — a conflicting insert surfaces P2002,
 * mapped here to "already-exists" so concurrent duplicate requests leave
 * exactly one winner. Never touches Order.status, OrderStatusHistory,
 * payments, or inventory.
 */
async function createReturnTx({ orderId, userId, orderNumber, reason, details }) {
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.returnRequest.create({
        data: { orderId, userId, status: "REQUESTED", reason, details },
        select: { id: true },
      });
      await tx.returnRequestHistory.create({
        data: { returnRequestId: created.id, status: "REQUESTED", actorId: userId, metadata: null },
        select: { id: true },
      });
      await tx.notification.create({
        data: {
          userId,
          type: "ORDER_STATUS",
          title: "Return requested",
          message: `Return requested for order ${orderNumber}. We'll update you here.`,
          orderId,
        },
        select: { id: true },
      });
      return tx.returnRequest.findUniqueOrThrow({
        where: { id: created.id },
        select: RETURN_SELECT,
      });
    });
    return { outcome: "ok", row };
  } catch (err) {
    if (err.code === "P2002") {
      return { outcome: "already-exists" };
    }
    throw err;
  }
}

module.exports = { findOrderForReturn, findReturnByOrderId, createReturnTx, findReturnsAdmin, findReturnByIdAdmin };
