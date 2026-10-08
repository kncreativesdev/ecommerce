const { AppError } = require("../../utils/appError");
const returnsRepository = require("./returns.repository");
const { toSafeReturnRequest, toSafeAdminReturnRequest } = require("./returns.utils");
const { resolveActorSnapshot, assertAuditInput } = require("../audit/audit.service");

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

/**
 * Phase 2C-2 request guard (mirrors the orders service): company-scoped
 * return operations need the server-resolved companyId.
 */
function assertRequestCompany(companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  return companyId;
}

async function requestReturn(userId, companyId, orderId, input) {
  assertRequestCompany(companyId);
  const order = await returnsRepository.findOrderForReturn(orderId, userId, companyId);
  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  assertReturnEligible(order);

  const existing = await returnsRepository.findReturnByOrderId(orderId);
  if (existing) {
    throw new AppError(409, "RETURN_ALREADY_REQUESTED", "A return request already exists for this order.");
  }

  const details = input.details?.trim() ? input.details.trim() : null;
  // Phase 2C-17: return requests are dispute-relevant administrative
  // events (the REQUESTED-only workflow has no other actor trail, and
  // ReturnRequestHistory carries no company scope). Only the
  // constrained reason enum is recorded — free-text details stay out.
  // No controller change needed: userId is already the server-side
  // caller identity.
  const snapshot = await resolveActorSnapshot(userId);
  const result = await returnsRepository.createReturnTx({
    orderId,
    userId,
    orderNumber: order.orderNumber,
    reason: input.reason,
    details,
    auditLog: assertAuditInput({
      actorId: snapshot.id,
      actorRole: snapshot.role,
      actorEmail: snapshot.email,
      companyId,
      action: "CREATED",
      resource: "RETURN",
      resourceId: null,
      outcome: "SUCCESS",
      details: { orderId, reason: input.reason },
    }),
  });
  if (result.outcome === "already-exists") {
    // Lost a concurrent duplicate-creation race: exactly one winner exists.
    throw new AppError(409, "RETURN_ALREADY_REQUESTED", "A return request already exists for this order.");
  }
  return toSafeReturnRequest(result.row);
}

async function getReturn(userId, companyId, orderId) {
  assertRequestCompany(companyId);
  const order = await returnsRepository.findOrderForReturn(orderId, userId, companyId);
  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  const row = await returnsRepository.findReturnByOrderId(orderId);
  return row ? toSafeReturnRequest(row) : null;
}

async function listReturnsAdmin(companyId, query) {
  assertRequestCompany(companyId);
  const page = query.page ?? ADMIN_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? ADMIN_DEFAULT_LIMIT, ADMIN_MAX_LIMIT);
  const search = query.search ? query.search.trim() : "";
  const { rows, total } = await returnsRepository.findReturnsAdmin({
    companyId,
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

async function getReturnAdmin(companyId, id) {
  assertRequestCompany(companyId);
  const row = await returnsRepository.findReturnByIdAdmin(id, companyId);
  if (!row) {
    throw new AppError(404, "RETURN_NOT_FOUND", "Return request not found");
  }
  return toSafeAdminReturnRequest(row);
}

module.exports = { requestReturn, getReturn, listReturnsAdmin, getReturnAdmin, RETURNABLE_ORDER_STATUSES };
