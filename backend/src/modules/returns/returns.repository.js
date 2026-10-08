const { prisma } = require("../../config/database");
const auditRepository = require("../audit/audit.repository");

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
async function findOrderForReturn(orderId, userId, companyId) {
  return prisma.order.findFirst({
    where: { id: orderId, userId, user: { companyId } },
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
async function findReturnsAdmin({ companyId, status, search, skip, take }) {
  // Company boundary through the return's owning customer (the return
  // user is always the order user by creation rule). Phase 2C-2.
  const and = [{ user: { companyId } }];
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

async function findReturnByIdAdmin(id, companyId) {
  return prisma.returnRequest.findFirst({
    where: { id, user: { companyId } },
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
async function createReturnTx({ orderId, userId, orderNumber, reason, details, auditLog = null }) {
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
      // Phase 2C-17: the pre-validated creation audit commits with the
      // request it describes (duplicate-race P2002 rolls everything
      // back, audit included).
      if (auditLog) {
        await auditRepository.createAuditEvent({ ...auditLog, resourceId: created.id }, tx);
      }
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
