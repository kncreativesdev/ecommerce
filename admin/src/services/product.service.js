import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/apiClient.js';

/**
 * Admin product API access — DOCUMENTED endpoints only (verified:
 * `products.routes|controller|service|validation`, API_CONTRACT_MATRIX):
 *
 * - `GET /products` (public default) → bare array, active only.
 *   `?status=active|inactive|all` selects the scope; `inactive`/`all`
 *   require ADMIN (else 401/403), invalid values → `422`. Reactivation is
 *   `PATCH { isActive: true }` — there is no dedicated restore endpoint.
 * - `GET /products/:id` → `{ product }`; `?status=all` (ADMIN) reads
 *   inactive rows with all variants; otherwise `404 PRODUCT_NOT_FOUND`.
 * - `POST /products` (ADMIN) → `201 { product }`. Writable:
 *   `name*` (1–255), `slug?` (≤280, auto-derived), `description?`,
 *   `shortDescription?`, `brand?` (≤100), `categoryId*` (must reference an
 *   ACTIVE category → else `404 CATEGORY_NOT_FOUND`), `isActive?`,
 *   `isFeatured?`, `variants?[]` (`{ sku*, name*, price*, compareAtPrice?,
 *   barcode?, weight?, isActive? }`, money as decimal strings/numbers).
 *   Strict body: unknown fields (including any `subcategoryId`) → `422`.
 * - `PATCH /products/:id` (ADMIN) → product fields ONLY (same minus
 *   `variants` — variants are managed via the dedicated variant
 *   endpoints, a follow-up milestone). Empty object → `422
 *   PRODUCT_UPDATE_INVALID`.
 *
 * Deliberately NOT exposed: `POST /products/:id/subcategory` and any
 * `subcategoryId` handling — no such backend field exists. The product
 * payload adapter (`utils/productPayload.js`) is the single place that
 * will add it once the backend supports product→subcategory persistence.
 */
export function fetchProducts(status = 'active') {
  const query = status && status !== 'active' ? `?status=${encodeURIComponent(status)}` : '';
  return apiGet(`/products${query}`);
}

export function fetchProductById(id, scope = 'active') {
  const query = scope && scope !== 'active' ? `?status=${encodeURIComponent(scope)}` : '';
  return apiGet(`/products/${id}${query}`).then((data) => data?.product ?? null);
}

export function createProduct(payload) {
  return apiPost('/products', payload).then((data) => data?.product ?? null);
}

export function updateProduct(id, payload) {
  return apiPatch(`/products/${id}`, payload).then((data) => data?.product ?? null);
}

/**
 * Product deactivate — `DELETE /products/:id` (ADMIN) → `200 { product }`.
 * SOFT-DEACTIVATE (`isActive=false`, hidden from storefront reads).
 * Repeat/unknown ids → `404 PRODUCT_NOT_FOUND`.
 */
export function deactivateProduct(id) {
  return apiDelete(`/products/${id}`).then((data) => data?.product ?? null);
}

/** Reactivate: documented `PATCH { isActive: true }` (no dedicated endpoint). */
export function activateProduct(id) {
  return apiPatch(`/products/${id}`, { isActive: true }).then(
    (data) => data?.product ?? null,
  );
}

/**
 * Dedicated variant endpoints (ADMIN). Bodies are strict — only documented
 * fields: `sku*`, `name*`, `price*` (decimal string/number), plus optional
 * `compareAtPrice`, `barcode`, `weight`, `isActive`. No stock/inventory
 * fields (separate milestone).
 * - `POST /products/:productId/variants` → `201 { variant }`.
 * - `PATCH .../variants/:variantId` → `200 { variant }` (non-empty subset).
 * - `DELETE .../variants/:variantId` → `200 { variant }` SOFT-DEACTIVATE
 *   (`isActive=false`). Repeat/unknown ids → `404 PRODUCT_VARIANT_NOT_FOUND`.
 */
export function createVariant(productId, payload) {
  return apiPost(`/products/${productId}/variants`, payload).then((data) => data?.variant ?? null);
}

export function updateVariant(productId, variantId, payload) {
  return apiPatch(`/products/${productId}/variants/${variantId}`, payload).then(
    (data) => data?.variant ?? null,
  );
}

export function deactivateVariant(productId, variantId) {
  return apiDelete(`/products/${productId}/variants/${variantId}`).then(
    (data) => data?.variant ?? null,
  );
}
