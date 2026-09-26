const { AppError } = require("../../utils/appError");
const ordersRepository = require("./orders.repository");
const couponsService = require("../coupons/coupons.service");
const { toSafeOrder, toSafeAdminOrder } = require("./orders.utils");

/**
 * REAL order state machine (source of truth for admin operations).
 * Full fulfilment workflow (current `OrderStatus` enum; SHIPPED is a
 * legacy state — see schema docs — never produced by new transitions):
 * - PENDING → CONFIRMED | CANCELLED
 * - CONFIRMED → PROCESSING | CANCELLED
 * - PROCESSING → DISPATCHED | CANCELLED
 * - DISPATCHED → IN_TRANSIT
 * - IN_TRANSIT → ARRIVED_IN_CITY
 * - ARRIVED_IN_CITY → OUT_FOR_DELIVERY
 * - OUT_FOR_DELIVERY → DELIVERED
 * - DELIVERED → COMPLETED (courier handover vs. lifecycle closure are
 *   distinct: DELIVERED records receipt, COMPLETED closes the order)
 * - COMPLETED / CANCELLED are terminal.
 * - SHIPPED (legacy) → IN_TRANSIT | DELIVERED compatibility path only.
 * Backwards moves are never allowed. Payment state is separate (see
 * PAYMENT_STATUS_TRANSITIONS). CANCELLING restores inventory via the
 * repository transaction; no other transition touches stock.
 */
const ORDER_STATUS_TRANSITIONS = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["IN_TRANSIT"],
  IN_TRANSIT: ["ARRIVED_IN_CITY"],
  ARRIVED_IN_CITY: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  // Legacy compatibility only: historical SHIPPED orders keep moving
  // forward without inventing history. Never transition INTO shipped.
  SHIPPED: ["IN_TRANSIT", "DELIVERED"],
};

/**
 * Canonical lifecycle order (oldest → newest) for timeline rendering.
 * SHIPPED sorts at the DISPATCHED position (same fulfilment step).
 */
const ORDER_STATUS_SEQUENCE = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "DISPATCHED",
  "IN_TRANSIT",
  "ARRIVED_IN_CITY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "COMPLETED",
];

function normalizeLifecycleStatus(status) {
  return status === "SHIPPED" ? "DISPATCHED" : status;
}

/**
 * Server-centralized customer notification copy per order status.
 * Single definition — frontends never duplicate these strings.
 */
function orderStatusNotification(orderNumber, status) {
  const tag = `order ${orderNumber}`;
  switch (status) {
    case "CONFIRMED":
      return { title: "Order confirmed", message: `Your ${tag} has been confirmed.` };
    case "PROCESSING":
      return { title: "Order being prepared", message: `Your ${tag} is being prepared.` };
    case "DISPATCHED":
    case "SHIPPED":
      return { title: "Order shipped from store", message: `Your ${tag} has left our store.` };
    case "IN_TRANSIT":
      return { title: "Order on the way", message: `Your ${tag} is on the way.` };
    case "ARRIVED_IN_CITY":
      return { title: "Order arrived in your city", message: `Your ${tag} has arrived in your city.` };
    case "OUT_FOR_DELIVERY":
      return { title: "Order out for delivery", message: `Your ${tag} is out for delivery.` };
    case "DELIVERED":
      return { title: "Order delivered", message: `Your ${tag} has been delivered.` };
    case "COMPLETED":
      return { title: "Order completed", message: `Your ${tag} is now completed. Thank you for shopping with Tech Pulse!` };
    case "CANCELLED":
      return { title: "Order cancelled", message: `Your ${tag} has been cancelled.` };
    default:
      return { title: "Order update", message: `Your ${tag} is now ${status}.` };
  }
}

/**
 * REAL payment state machine for COD/manual payments
 * (Prisma `PaymentStatus` enum; method is always CASH_ON_DELIVERY).
 * - PENDING → PAID (cash collected) | FAILED (collection failed)
 * - FAILED → PAID (retry / manual correction)
 * - PAID → REFUNDED (manual refund recorded; no gateway integration)
 * - REFUNDED is terminal. There is no online capture — REFUNDED is a
 *   recorded state, not a processed payout.
 */
const PAYMENT_STATUS_TRANSITIONS = {
  PENDING: ["PAID", "FAILED"],
  FAILED: ["PAID"],
  PAID: ["REFUNDED"],
  REFUNDED: [],
};

const ADMIN_DEFAULT_PAGE = 1;
const ADMIN_DEFAULT_LIMIT = 20;
const ADMIN_MAX_LIMIT = 100;

function parseAdminDate(value, field) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new AppError(422, "VALIDATION_ERROR", `Invalid ${field} date. Use an ISO-8601 date string.`);
  }
  return new Date(time);
}

const ORDER_NUMBER_ATTEMPTS = 5;

function isOrderNumberConflict(err) {
  if (err.code !== "P2002") {
    return false;
  }
  const meta = err.meta || {};
  if (Array.isArray(meta.target)) {
    return meta.target.map(String).join(",").toLowerCase().includes("order_number");
  }
  const cause = meta.driverAdapterError?.cause || {};
  const parts = [];
  if (cause.constraint && typeof cause.constraint.index === "string") {
    parts.push(cause.constraint.index);
  }
  if (typeof cause.originalMessage === "string") {
    parts.push(cause.originalMessage);
  }
  return parts.join(",").toLowerCase().includes("order_number");
}

function parseSequence(orderNumber, year) {
  const match = /^ORD-(\d{4})-(\d+)$/.exec(orderNumber || "");
  if (!match || Number(match[1]) !== year) {
    return 0;
  }
  const seq = Number.parseInt(match[2], 10);
  return Number.isInteger(seq) && seq > 0 ? seq : 0;
}

async function nextOrderNumber() {
  const year = new Date().getUTCFullYear();
  const latest = await ordersRepository.findLatestOrderNumberForYear(year);
  const sequence = parseSequence(latest, year) + 1;
  if (sequence > 999999) {
    throw new AppError(500, "ORDER_NUMBER_GENERATION_FAILED", "Order number sequence exhausted");
  }
  return ordersRepository.buildOrderNumber(year, sequence);
}

async function createOrder(userId, input) {
  const shippingAddress = await ordersRepository.findAddressByIdAndUserId(
    input.shippingAddressId,
    userId
  );
  if (!shippingAddress) {
    throw new AppError(404, "ORDER_ADDRESS_NOT_FOUND", "Shipping address not found");
  }

  let billingAddress = null;
  if (input.billingAddressId !== undefined) {
    billingAddress = await ordersRepository.findAddressByIdAndUserId(
      input.billingAddressId,
      userId
    );
    if (!billingAddress) {
      throw new AppError(404, "ORDER_ADDRESS_NOT_FOUND", "Billing address not found");
    }
  }

  // Optional coupon: validated ONCE here against the current cart (fresh,
  // authoritative quote). The discount amount and coupon id ride into the
  // transaction; usage is consumed INSIDE it so failed orders never
  // consume and races hit the guarded increment (409) instead of
  // overshooting the limit.
  let coupon = null;
  if (input.couponCode !== undefined) {
    const quote = await couponsService.validateCouponForUserCart(userId, input.couponCode);
    coupon = { couponId: quote.coupon.id, discountTotal: quote.discountAmount };
  }

  let lastError = null;
  for (let attempt = 0; attempt < ORDER_NUMBER_ATTEMPTS; attempt += 1) {
    const orderNumber = await nextOrderNumber();
    let result;
    try {
      result = await ordersRepository.createOrderTransaction(
        userId,
        orderNumber,
        shippingAddress,
        billingAddress,
        coupon
      );
    } catch (err) {
      if (isOrderNumberConflict(err)) {
        lastError = err;
        continue;
      }
      throw err;
    }

    if (result.outcome === "empty") {
      throw new AppError(422, "ORDER_EMPTY_CART", "Cart is empty");
    }
    if (result.outcome === "inactive") {
      throw new AppError(422, "ORDER_VARIANT_INACTIVE", "One or more cart items are not available");
    }
    if (result.outcome === "insufficient") {
      throw new AppError(409, "ORDER_INSUFFICIENT_STOCK", "Insufficient stock for one or more items");
    }
    return getOrder(userId, result.orderId);
  }

  if (lastError) {
    throw lastError;
  }
  throw new AppError(500, "ORDER_NUMBER_GENERATION_FAILED", "Could not generate a unique order number");
}

async function listOrders(userId) {
  const rows = await ordersRepository.findOrdersByUserId(userId);
  return rows.map(toSafeOrder);
}

async function getOrder(userId, id) {
  const row = await ordersRepository.findOrderByIdAndUserId(id, userId);
  if (!row) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  return toSafeOrder(row);
}

async function listOrdersAdmin(query) {
  const page = query.page ?? ADMIN_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? ADMIN_DEFAULT_LIMIT, ADMIN_MAX_LIMIT);
  const fromDate = query.from ? parseAdminDate(query.from, "from") : null;
  const toDate = query.to ? parseAdminDate(query.to, "to") : null;
  if (fromDate && toDate && fromDate > toDate) {
    throw new AppError(422, "VALIDATION_ERROR", "Invalid date range: `from` is after `to`.");
  }
  const search = query.search ? query.search.trim() : "";
  const city = query.city ? query.city.trim() : "";
  const state = query.state ? query.state.trim() : "";
  const { rows, total } = await ordersRepository.findOrdersAdmin({
    status: query.status ?? null,
    paymentStatus: query.paymentStatus ?? null,
    search: search === "" ? null : search,
    city: city === "" ? null : city,
    state: state === "" ? null : state,
    fromDate,
    toDate,
    sortBy: query.sortBy ?? "createdAt",
    sortOrder: query.sortOrder ?? "desc",
    skip: (page - 1) * limit,
    take: limit,
  });
  return {
    orders: rows.map(toSafeAdminOrder),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function getOrderAdmin(id) {
  const row = await ordersRepository.findOrderByIdAdmin(id);
  if (!row) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  return toSafeAdminOrder(row);
}

async function updateOrderStatusAdmin(id, nextStatus, options = {}) {
  const current = await ordersRepository.findOrderByIdAdmin(id);
  if (!current) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  if (current.status === nextStatus) {
    throw new AppError(
      409,
      "ORDER_STATUS_UNCHANGED",
      `Order is already ${current.status}. No update was applied.`
    );
  }
  const allowed = ORDER_STATUS_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    const hint =
      allowed.length > 0
        ? `Allowed next states from ${current.status}: ${allowed.join(", ")}.`
        : `${current.status} is terminal and cannot change.`;
    throw new AppError(
      409,
      "ORDER_INVALID_STATUS_TRANSITION",
      `Cannot move order from ${current.status} to ${nextStatus}. ${hint}`
    );
  }
  const result = await ordersRepository.updateOrderStatusTransaction(
    id,
    current.status,
    nextStatus,
    {
      note: options.note ?? null,
      createdBy: options.createdBy ?? null,
      notification: orderStatusNotification(current.orderNumber, nextStatus),
    }
  );
  if (result.outcome === "missing") {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  if (result.outcome === "conflict") {
    throw new AppError(
      409,
      "ORDER_CONCURRENT_UPDATE",
      `Order changed while updating (now ${result.status}). Reload and retry.`
    );
  }
  return getOrderAdmin(id);
}

/**
 * Atomic bulk status update (all-or-nothing).
 *
 * Behavior: every selected order is validated against the authoritative
 * ORDER_STATUS_TRANSITIONS map BEFORE any write. If any order is missing,
 * already in the target status, or requests an illegal transition, the
 * whole operation fails with explicit per-order failures and NO order is
 * modified. Otherwise all orders transition inside ONE database
 * transaction (status + exactly one history row + exactly one customer
 * notification each, atomically). Concurrency conflicts roll back the
 * whole bulk — never partial success reported as success.
 */
async function bulkUpdateOrderStatusAdmin(orderIds, nextStatus, options = {}) {
  const uniqueIds = [...new Set(orderIds)];
  const failures = [];
  const expectedById = {};
  for (const id of uniqueIds) {
    const current = await ordersRepository.findOrderByIdAdmin(id);
    if (!current) {
      failures.push({ orderId: id, code: "ORDER_NOT_FOUND", message: "Order not found" });
      continue;
    }
    if (current.status === nextStatus) {
      failures.push({
        orderId: id,
        orderNumber: current.orderNumber,
        code: "ORDER_STATUS_UNCHANGED",
        message: `Order ${current.orderNumber} is already ${current.status}.`,
      });
      continue;
    }
    const allowed = ORDER_STATUS_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      failures.push({
        orderId: id,
        orderNumber: current.orderNumber,
        code: "ORDER_INVALID_STATUS_TRANSITION",
        message: `Cannot move order ${current.orderNumber} from ${current.status} to ${nextStatus}.`,
      });
      continue;
    }
    expectedById[id] = current.status;
  }
  if (failures.length > 0) {
    throw new AppError(409, "ORDER_BULK_VALIDATION_FAILED", "One or more orders cannot make the requested transition", failures);
  }
  await ordersRepository.bulkUpdateOrderStatusTransaction(uniqueIds, expectedById, nextStatus, {
    note: options.note ?? null,
    createdBy: options.createdBy ?? null,
    notificationFor: (orderNumber, status) => orderStatusNotification(orderNumber, status),
  });
  const orders = [];
  for (const id of uniqueIds) {
    orders.push(await getOrderAdmin(id));
  }
  return { orders };
}

async function updateOrderPaymentStatusAdmin(id, nextStatus) {
  const current = await ordersRepository.findOrderByIdAdmin(id);
  if (!current) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  const latest = (current.payments || []).reduce((acc, payment) => {
    if (!acc) {
      return payment;
    }
    return new Date(payment.createdAt) >= new Date(acc.createdAt) ? payment : acc;
  }, null);
  if (!latest) {
    throw new AppError(409, "ORDER_PAYMENT_MISSING", "Order has no payment record to update");
  }
  const allowed = PAYMENT_STATUS_TRANSITIONS[latest.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    const hint =
      allowed.length > 0
        ? `Allowed next states from ${latest.status}: ${allowed.join(", ")}.`
        : `${latest.status} is terminal and cannot change.`;
    throw new AppError(
      409,
      "PAYMENT_INVALID_STATUS_TRANSITION",
      `Cannot move payment from ${latest.status} to ${nextStatus}. ${hint}`
    );
  }
  const result = await ordersRepository.updateOrderPaymentStatusTransaction(
    id,
    latest.status,
    nextStatus
  );
  if (result.outcome === "missing") {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  if (result.outcome === "payment-missing") {
    throw new AppError(409, "ORDER_PAYMENT_MISSING", "Order has no payment record to update");
  }
  if (result.outcome === "conflict") {
    throw new AppError(
      409,
      "ORDER_CONCURRENT_UPDATE",
      `Payment changed while updating (now ${result.status}). Reload and retry.`
    );
  }
  return getOrderAdmin(id);
}

module.exports = {
  createOrder,
  listOrders,
  getOrder,
  listOrdersAdmin,
  getOrderAdmin,
  updateOrderStatusAdmin,
  bulkUpdateOrderStatusAdmin,
  updateOrderPaymentStatusAdmin,
  ORDER_STATUS_TRANSITIONS,
  ORDER_STATUS_SEQUENCE,
  PAYMENT_STATUS_TRANSITIONS,
  normalizeLifecycleStatus,
  orderStatusNotification,
};
