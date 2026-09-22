import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/apiClient.js';

/**
 * Cart API access — server-side authenticated cart (API_INTEGRATION §9,
 * verified `cart.controller|service|validation`):
 * - `GET /cart` → lazy-creates, returns `{ cart }`.
 * - `POST /cart/items { variantId, quantity ≥ 1 }` → INCREMENTS existing
 *   line, returns updated `{ cart }`.
 * - `PATCH /cart/items/:itemId { quantity ≥ 1 }` → ABSOLUTE set, returns
 *   updated `{ cart }`.
 * - `DELETE /cart/items/:itemId` → returns updated `{ cart }`. Repeat →
 *   `404` (callers treat as already-removed). No clear-all endpoint.
 * Never sends `userId`, prices, `productId`, or stock fields.
 */
export function fetchCart() {
  return apiGet('/cart').then((data) => data?.cart ?? null);
}

export function addCartItem({ variantId, quantity }) {
  return apiPost('/cart/items', { variantId, quantity }).then((data) => data?.cart ?? null);
}

export function updateCartItemQuantity(itemId, quantity) {
  return apiPatch(`/cart/items/${itemId}`, { quantity }).then((data) => data?.cart ?? null);
}

export function removeCartItem(itemId) {
  return apiDelete(`/cart/items/${itemId}`).then((data) => data?.cart ?? null);
}
