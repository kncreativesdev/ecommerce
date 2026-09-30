function toSafeReturnRequest(row) {
  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    reason: row.reason,
    details: row.details ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function formatDecimal(value, decimals) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value !== null && typeof value === "object" && typeof value.toFixed === "function") {
    return value.toFixed(decimals);
  }
  return String(value);
}

/**
 * Admin-safe return DTO: base request plus the customer brief and order
 * summary needed to understand "this request belongs to this order,
 * submitted by this customer". No password hashes, tokens, or unrelated
 * user data. History is embedded only when the query selected it.
 */
function toSafeAdminReturnRequest(row) {
  return {
    ...toSafeReturnRequest(row),
    customer: row.user
      ? {
          id: row.user.id,
          email: row.user.email,
          firstName: row.user.firstName ?? null,
          lastName: row.user.lastName ?? null,
          phone: row.user.phone ?? null,
        }
      : null,
    order: row.order
      ? {
          id: row.order.id,
          orderNumber: row.order.orderNumber,
          status: row.order.status,
          grandTotal: formatDecimal(row.order.grandTotal, 2),
          createdAt: row.order.createdAt,
        }
      : null,
    ...(row.history !== undefined
      ? {
          history: (row.history || []).map((entry) => ({
            id: entry.id,
            status: entry.status,
            actorId: entry.actorId ?? null,
            createdAt: entry.createdAt,
          })),
        }
      : {}),
  };
}

module.exports = { toSafeReturnRequest, toSafeAdminReturnRequest };
