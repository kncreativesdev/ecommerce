import { apiDelete, apiGet, apiPost } from '../lib/apiClient.js';

/**
 * Wishlist API access — product-level, owner-scoped (API_INTEGRATION §10,
 * verified `wishlist.controller|service`):
 * - `GET /wishlist` → `{ wishlist }` (lazy-created).
 * - `POST /wishlist/items { productId }` → updated `{ wishlist }`.
 *   `409 WISHLIST_ITEM_EXISTS` → treat as saved (callers handle).
 * - `DELETE /wishlist/items/:itemId` → updated `{ wishlist }`. Repeat →
 *   `404` (callers treat as already-removed).
 * Sends ONLY `{ productId }` on add — no variants, quantities, or prices.
 */
export function fetchWishlist() {
  return apiGet('/wishlist').then((data) => data?.wishlist ?? null);
}

export function addWishlistItem(productId) {
  return apiPost('/wishlist/items', { productId }).then((data) => data?.wishlist ?? null);
}

export function removeWishlistItem(itemId) {
  return apiDelete(`/wishlist/items/${itemId}`).then((data) => data?.wishlist ?? null);
}
