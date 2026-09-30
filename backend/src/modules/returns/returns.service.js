const { AppError } = require("../../utils/appError");
const returnsRepository = require("./returns.repository");
const { toSafeReturnRequest, toSafeAdminReturnRequest } = require("./returns.utils");

const ADMIN_DEFAULT_PAGE = 1;
const ADMIN_DEFAULT_LIMIT = 20;
const ADMIN_MAX_LIMIT = 100;

/**
 * Return eligibility (smallest defensible rule for the current domain):
 * only orders the customer has actually received can be returned —
 * DELIVERED (receipt) or COMPLETED (lifecycle closure). Everything else
 * is rejected before any write. No return window exists in the domain, so
 * none is invented here.
 */
const RETURNABLE_ORDER_STATUSES = new Set(["DELIVERED", "COMPLETED"]);

function assertReturnEligible(order) {
  if (order.status === "CANCELLED") {
    throw new AppError(422, "ORDER_RETURN_NOT_ELIGIBLE", "Cancelled orders cannot be returned.");
  }
  if (!RETURNABLE_ORDER_STATUSES.has(order.status)) {
    throw new AppError(422, "ORDER_RETURN_NOT_ELIGIBLE", "Only delivered orders can be returned.");
  }
}

async function requestReturn(userId, orderId, input) {
  const order = await returnsRepository.findOrderForReturn(orderId, userId);
  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  assertReturnEligible(order);

  const existing = await returnsRepository.findReturnByOrderId(orderId);
  if (existing) {
    throw new AppError(409, "RETURN_ALREADY_REQUESTED", "A return request already exists for this order.");
  }

  const details = input.details?.trim() ? input.details.trim() : null;
  const result = await returnsRepository.createReturnTx({
    orderId,
    userId,
    orderNumber: order.orderNumber,
    reason: input.reason,
    details,
  });
  if (result.outcome === "already-exists") {
    // Lost a concurrent duplicate-creation race: exactly one winner exists.
    throw new AppError(409, "RETURN_ALREADY_REQUESTED", "A return request already exists for this order.");
  }
  return toSafeReturnRequest(result.row);
}

async function getReturn(userId, orderId) {
  const order = await returnsRepository.findOrderForReturn(orderId, userId);
  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  const row = await returnsRepository.findReturnByOrderId(orderId);
  return row ? toSafeReturnRequest(row) : null;
}

async function listReturnsAdmin(query) {
  const page = query.page ?? ADMIN_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? ADMIN_DEFAULT_LIMIT, ADMIN_MAX_LIMIT);
  const search = query.search ? query.search.trim() : "";
  const { rows, total } = await returnsRepository.findReturnsAdmin({
    status: query.status ?? null,
    search: search === "" ? null : search,
    skip: (page - 1) * limit,
    take: limit,
  });
  return {
    returns: rows.map(toSafeAdminReturnRequest),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function getReturnAdmin(id) {
  const row = await returnsRepository.findReturnByIdAdmin(id);
  if (!row) {
    throw new AppError(404, "RETURN_NOT_FOUND", "Return request not found");
  }
  return toSafeAdminReturnRequest(row);
}

module.exports = { requestReturn, getReturn, listReturnsAdmin, getReturnAdmin, RETURNABLE_ORDER_STATUSES };
