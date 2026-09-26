function formatDecimal(value, decimals) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value !== null && typeof value === "object" && typeof value.toFixed === "function") {
    return value.toFixed(decimals);
  }
  return String(value);
}

function priceToCents(value) {
  const str = formatDecimal(value, 2);
  const dot = str.indexOf(".");
  const intPart = dot === -1 ? str : str.slice(0, dot);
  const fracPart = (dot === -1 ? "" : str.slice(dot + 1)).padEnd(2, "0").slice(0, 2);
  return BigInt(intPart === "" ? "0" : intPart) * 100n + BigInt(fracPart);
}

function centsToString(cents) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const units = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${units.toString()}.${frac}`;
}

function toSafeOrderItem(item) {
  return {
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    productName: item.productName,
    variantName: item.variantName ?? null,
    sku: item.sku,
    unitPrice: formatDecimal(item.unitPrice, 2),
    discount: formatDecimal(item.discount, 2),
    quantity: item.quantity,
    lineTotal: formatDecimal(item.lineTotal, 2),
    imageStoragePath: item.imageStoragePath ?? null,
    createdAt: item.createdAt,
  };
}

function toSafeOrderAddress(address) {
  return {
    id: address.id,
    type: address.type,
    fullName: address.fullName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? null,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
  };
}

function toSafePayment(payment) {
  return {
    id: payment.id,
    method: payment.method,
    status: payment.status,
    amount: formatDecimal(payment.amount, 2),
    currency: payment.currency,
    transactionReference: payment.transactionReference ?? null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function toSafeOrderStatusHistory(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    status: entry.status,
    previousStatus: entry.previousStatus ?? null,
    note: entry.note ?? null,
    createdAt: entry.createdAt,
  };
}

function toSafeOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    subtotal: formatDecimal(order.subtotal, 2),
    discountTotal: formatDecimal(order.discountTotal, 2),
    shippingTotal: formatDecimal(order.shippingTotal, 2),
    taxTotal: formatDecimal(order.taxTotal, 2),
    grandTotal: formatDecimal(order.grandTotal, 2),
    currency: order.currency,
    items: (order.items || []).map(toSafeOrderItem),
    addresses: (order.addresses || []).map(toSafeOrderAddress),
    payments: (order.payments || []).map(toSafePayment),
    // Authoritative lifecycle ledger, oldest first. Legacy orders
    // predate the table and carry an empty array — readers must fall
    // back to `status`/`createdAt`/`updatedAt` and never invent rows.
    statusHistory: (order.statusHistory || []).map(toSafeOrderStatusHistory),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Admin order view: customer `toSafeOrder` shape plus a minimal customer
 * brief (id/email/name/phone) for operations. Never exposes password
 * hashes or tokens — the select layer already restricts to these fields.
 */
function toSafeAdminOrder(order) {
  const base = toSafeOrder(order);
  const user = order.user || null;
  return {
    ...base,
    userId: order.userId ?? user?.id ?? null,
    customer: user
      ? {
          id: user.id,
          email: user.email,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          phone: user.phone ?? null,
        }
      : null,
  };
}

module.exports = {
  toSafeOrder,
  toSafeAdminOrder,
  toSafeOrderItem,
  toSafeOrderAddress,
  toSafePayment,
  toSafeOrderStatusHistory,
  formatDecimal,
  priceToCents,
  centsToString,
};
