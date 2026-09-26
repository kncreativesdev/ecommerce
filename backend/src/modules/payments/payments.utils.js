function formatDecimal(value, decimals) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value !== null && typeof value === "object" && typeof value.toFixed === "function") {
    return value.toFixed(decimals);
  }
  return String(value);
}

function toSafePayment(payment) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    method: payment.method,
    status: payment.status,
    amount: formatDecimal(payment.amount, 2),
    currency: payment.currency,
    transactionReference: payment.transactionReference ?? null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

module.exports = { toSafePayment, formatDecimal };
