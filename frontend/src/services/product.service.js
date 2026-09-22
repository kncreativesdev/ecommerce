import { apiGet } from '../lib/apiClient.js';

/**
 * Product/catalog API access — the ONLY place that calls product endpoints.
 * Thin wrappers over DOCUMENTED backend routes (verified in
 * `backend/src/modules/products/`: routes + controller + service +
 * repository; API_INTEGRATION.md §6, API_CONTRACT_MATRIX):
 *
 * - `GET /products` (PUBLIC) → `200 { success, data: [...] }`, bare array,
 *   active products only (`createdAt` ascending), active variants only.
 *   The controller ignores query strings: NO pagination, filtering,
 *   sorting, or search parameters are supported. All Shop filtering /
 *   sorting is therefore client-side over this payload until the backend
 *   adds query support (BACKEND_REQUIREMENTS_GAP.md GAP-04).
 * - `GET /products/:id` (PUBLIC) → `200 { success, data: { product } }`;
 *   `404 PRODUCT_NOT_FOUND` for missing/inactive products.
 *
 * Deliberately NOT exposed here:
 * - category/subcategory/search/sort/pagination query params — undocumented.
 * - `POST/PATCH/DELETE /products[/variants]` (ADMIN-only) — admin
 *   milestones will add these alongside the auth store.
 * - product images — separate `GET /products/:productId/images` reads;
 *   the media milestone wires those (GAP-07). Product payloads carry NO
 *   embedded images.
 *
 * Services contain no React state; stores call these functions.
 */
export function fetchProducts() {
  return apiGet('/products');
}

export function fetchProductById(id) {
  return apiGet(`/products/${id}`).then((data) => data?.product ?? null);
}
