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
 * No cancellation or mutation endpoints exist — no such UI.
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
