import { apiGet, apiPost } from '../lib/apiClient.js';

/**
 * Orders API access — owner-scoped snapshots (API_INTEGRATION §11,
 * verified `orders.controller.js`):
 * - `POST /orders { shippingAddressId, billingAddressId?, couponCode? }`
 *   (STRICT — only these fields) → `201 { order }` with item/address/
 *   payment snapshots. A coupon code is optional: the backend validates
 *   it against the cart, writes the `discountTotal` snapshot, charges the
 *   discounted total, and consumes usage atomically. Never totals,
 *   statuses, or payment fields.
 * - `GET /orders` → bare array of own orders, newest first. (Controller
 *   returns `data` as the array; handled defensively.)
 * - `GET /orders/:id` → `{ order }`. Other users' ids → `404`.
 * - `POST /orders/:id/cancel` → customer self-cancellation of an eligible
 *   order → `200 { order }`. Only PENDING/CONFIRMED/PROCESSING orders can
 *   be cancelled (backend `ORDER_STATUS_TRANSITIONS`); anything else →
 *   `409 ORDER_INVALID_STATUS_TRANSITION`. Other users' ids → `404`.
 * - `POST /orders/:id/returns { reason, details? }` → customer return
 *   request for a delivered/completed order → `201 { returnRequest }`.
 *   Ineligible orders → `422 ORDER_RETURN_NOT_ELIGIBLE`; a second request
 *   for the same order → `409 RETURN_ALREADY_REQUESTED`.
 * - `GET /orders/:id/returns` → `{ returnRequest }` (null when none).
 *   Other users' ids → `404`. The order timeline is never affected.
 */
export function createOrder({ shippingAddressId, billingAddressId, couponCode }) {
  const body = { shippingAddressId };
  if (billingAddressId) body.billingAddressId = billingAddressId;
  if (couponCode) body.couponCode = couponCode;
  return apiPost('/orders', body).then((data) => data?.order ?? null);
}

export function fetchOrders() {
  return apiGet('/orders').then((data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.orders)) return data.orders;
    return [];
  });
}

export function fetchOrderById(id) {
  return apiGet(`/orders/${id}`).then((data) => data?.order ?? null);
}

export function cancelOrder(id) {
  return apiPost(`/orders/${id}/cancel`).then((data) => data?.order ?? null);
}

export function requestReturn(orderId, { reason, details }) {
  const body = { reason };
  if (details?.trim()) body.details = details.trim();
  return apiPost(`/orders/${orderId}/returns`, body).then((data) => data?.returnRequest ?? null);
}

export function fetchReturnRequest(orderId) {
  return apiGet(`/orders/${orderId}/returns`).then((data) => data?.returnRequest ?? null);
}
