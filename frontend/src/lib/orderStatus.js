/**
 * Canonical customer order lifecycle (mirrors backend `ORDER_STATUS_SEQUENCE`
 * in `orders.service.js` — the backend owns transitions; this module only
 * names them for display).
 *
 * Single definition imported by badges/timeline. Sequence + labels only —
 * icons stay in components (never icon names as strings).
 */

/** Canonical fulfilment order, oldest → newest. `CANCELLED` is terminal (off-sequence). */
export const ORDER_STATUS_SEQUENCE = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'DISPATCHED',
  'IN_TRANSIT',
  'ARRIVED_IN_CITY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
];

/**
 * Normalize legacy statuses to their canonical position (`SHIPPED` sorts at
 * the `DISPATCHED` step — same fulfilment step, no history invented).
 */
export function normalizeLifecycleStatus(status) {
  return status === 'SHIPPED' ? 'DISPATCHED' : status;
}

/** Customer-friendly step labels (single definition — badges/timeline share these). */
export const ORDER_STATUS_LABELS = {
  PENDING: 'Order Placed',
  CONFIRMED: 'Order Confirmed',
  PROCESSING: 'Preparing Your Order',
  SHIPPED: 'Shipped from Store',
  DISPATCHED: 'Shipped from Store',
  IN_TRANSIT: 'On the Way',
  ARRIVED_IN_CITY: 'Arrived in Your City',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  COMPLETED: 'Order Completed',
  CANCELLED: 'Cancelled',
};

/** Friendly label for any status; unknown values pass through verbatim (never blank). */
export function orderStatusLabel(status) {
  if (status == null || status === '') return 'Unknown';
  return ORDER_STATUS_LABELS[status] ?? String(status);
}

/**
 * Customer-cancellable statuses (mirrors the backend's cancellable scope
 * in `ORDER_STATUS_TRANSITIONS`: CANCELLED is reachable only from
 * PENDING, CONFIRMED, PROCESSING). Display-only gate for the Cancel Order
 * action — the backend remains authoritative and rejects anything else
 * with `409 ORDER_INVALID_STATUS_TRANSITION`.
 */
export const CANCELLABLE_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING'];

export function isOrderCancellable(orderOrStatus) {
  const status = typeof orderOrStatus === 'string' ? orderOrStatus : orderOrStatus?.status;
  return CANCELLABLE_ORDER_STATUSES.includes(status);
}

/**
 * Customer-returnable statuses (mirrors the backend return eligibility in
 * `returns.service.js`: only received orders — DELIVERED/COMPLETED).
 * Display-only gate for the Request Return action — the backend remains
 * authoritative and rejects anything else with
 * `422 ORDER_RETURN_NOT_ELIGIBLE`.
 */
export const RETURNABLE_ORDER_STATUSES = ['DELIVERED', 'COMPLETED'];

export function isOrderReturnable(orderOrStatus) {
  const status = typeof orderOrStatus === 'string' ? orderOrStatus : orderOrStatus?.status;
  return RETURNABLE_ORDER_STATUSES.includes(status);
}

/** Controlled return reasons (mirror backend `ReturnReason` enum). */
export const RETURN_REASON_OPTIONS = [
  { value: 'WRONG_COLOR', label: 'Wrong color' },
  { value: 'WRONG_SIZE', label: 'Wrong size' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'DEFECTIVE', label: 'Defective' },
  { value: 'WRONG_ITEM', label: 'Wrong item' },
  { value: 'NOT_AS_DESCRIBED', label: 'Not as described' },
  { value: 'CHANGED_MIND', label: 'Changed my mind' },
  { value: 'OTHER', label: 'Other' },
];

/** Human label for a return reason value; unknown values pass through verbatim. */
export function returnReasonLabel(reason) {
  if (reason == null || reason === '') return 'Unknown';
  return RETURN_REASON_OPTIONS.find((option) => option.value === reason)?.label ?? String(reason);
}

/** Human label for a return status value; unknown values pass through verbatim. */
export function returnStatusLabel(status) {
  if (status == null || status === '') return 'Unknown';
  const labels = {
    REQUESTED: 'Return requested',
    APPROVED: 'Return approved',
    REJECTED: 'Return rejected',
    COMPLETED: 'Return completed',
    CANCELLED: 'Return cancelled',
  };
  return labels[status] ?? String(status);
}
