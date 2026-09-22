/**
 * Frontend mirror of the backend order/payment state machines (source of
 * truth: `backend/src/modules/orders/orders.service.js`
 * `ORDER_STATUS_TRANSITIONS` / `PAYMENT_STATUS_TRANSITIONS`, Prisma
 * `OrderStatus` / `PaymentStatus` enums).
 *
 * Used ONLY to present reasonable next-state options. The backend remains
 * authoritative: every mutation still goes through the status endpoints
 * and `409` rejections (stale state, illegal move, concurrent update) are
 * surfaced with the server message plus a refetch of the authoritative
 * order. Never invent statuses here — keep in sync with the backend.
 */

export const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];

export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'];

/** Forward-only fulfilment; CANCELLED only before shipment. Terminal: DELIVERED, CANCELLED. */
export const ORDER_NEXT_STATES = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

/** COD/manual payment states; REFUNDED records a manual refund (no gateway). */
export const PAYMENT_NEXT_STATES = {
  PENDING: ['PAID', 'FAILED'],
  FAILED: ['PAID'],
  PAID: ['REFUNDED'],
  REFUNDED: [],
};

export function allowedOrderTransitions(status) {
  return ORDER_NEXT_STATES[status] ?? [];
}

export function allowedPaymentTransitions(status) {
  return PAYMENT_NEXT_STATES[status] ?? [];
}

/** Latest payment row drives the payment controls (checkout creates one COD row). */
export function latestPayment(order) {
  const payments = Array.isArray(order?.payments) ? order.payments : [];
  if (payments.length === 0) return null;
  return payments.reduce((current, payment) => {
    if (!current) return payment;
    return new Date(payment.createdAt) >= new Date(current.createdAt) ? payment : current;
  }, null);
}

export function customerDisplayName(customer) {
  if (!customer) return '—';
  const full = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
  return full !== '' ? full : (customer.email ?? '—');
}

export function orderItemCount(order) {
  if (!Array.isArray(order?.items)) return 0;
  return order.items.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0);
}
