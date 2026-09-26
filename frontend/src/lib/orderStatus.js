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
