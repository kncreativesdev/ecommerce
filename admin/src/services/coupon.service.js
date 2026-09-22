import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from '../lib/apiClient.js';

/**
 * Admin coupon API access — ADMIN-only `/coupons` endpoints (verified:
 * `coupons.routes|controller|service|validation`, API_CONTRACT_MATRIX).
 * The router is ADMIN-gated on every route; there are no customer coupon
 * endpoints (the internal validation service has no HTTP surface and no
 * checkout integration yet — see service docs).
 *
 * - `GET /coupons` → `200 { coupons[] } + meta { page, limit, total,
 *   totalPages }`. Query (explicit allowlist only):
 *   `?status=active|inactive|all` (default `all` — inactive/expired rows
 *   stay discoverable), `?search=` (code/description substring),
 *   `?page=` (default 1), `?limit=` (default 20, max 100). Newest first.
 * - `GET /coupons/:id` → `200 { coupon }`; unknown ids →
 *   `404 COUPON_NOT_FOUND`.
 * - `POST /coupons` (ADMIN) → `201 { coupon }`. Writable: `code*`
 *   (1–50, stored uppercased, unique → else `409 COUPON_CODE_EXISTS`),
 *   `description?` (≤500, nullable), `discountType*`
 *   (`PERCENTAGE|FIXED`), `discountValue*` (decimal string/number;
 *   percentage must be in (0, 100], fixed must be > 0 → else `422
 *   COUPON_INVALID_DISCOUNT`), `minimumOrderAmount?`,
 *   `maximumDiscountAmount?` (nullable amounts), `usageLimit?` (nullable
 *   int ≥ 1; null = unlimited), `startsAt?`/`expiresAt?` (nullable
 *   ISO-8601 date-times; expiry must be after start), `isActive?`
 *   (default true), `productIds?` (UUID array; unknown ids → `404
 *   PRODUCT_NOT_FOUND`). Strict body: unknown fields (including any
 *   per-customer limit, category ids, or `usedCount`) → `422`.
 * - `PATCH /coupons/:id` (ADMIN) → `200 { coupon }`. Partial subset of
 *   the same fields; empty object → `422 COUPON_UPDATE_INVALID`.
 *   Activate/deactivate is `PATCH { isActive }` — no dedicated endpoint.
 *   `usedCount` is NEVER writable (server-incremented only).
 * - `DELETE /coupons/:id` (ADMIN) → `200 { id, message }`. Hard delete;
 *   refused with `409 COUPON_IN_USE` once `usedCount > 0` (deactivate
 *   instead). Orders never reference coupons, so history is unaffected.
 *
 * Coupon shape: `{ id, code, description, discountType, discountValue,
 * minimumOrderAmount, maximumDiscountAmount, usageLimit, usedCount,
 * startsAt, expiresAt, isActive, products[] ({ productId }),
 * createdAt, updatedAt }`. Money arrives as `"xx.xx"` strings.
 */
export function fetchCoupons({ page = 1, limit = 20, status = 'all', search } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (status && status !== 'all') params.set('status', status);
  if (search && search.trim() !== '') params.set('search', search.trim());
  const query = params.toString();
  // `apiGetPage` (not `apiGet`): the list envelope carries pagination in
  // top-level `meta`, which the plain data-only helper drops.
  return apiGetPage(`/coupons${query ? `?${query}` : ''}`).then(({ data, meta }) => ({
    coupons: Array.isArray(data?.coupons) ? data.coupons : [],
    pagination: meta ?? { page, limit, total: 0, totalPages: 1 },
  }));
}

export function fetchCouponById(id) {
  return apiGet(`/coupons/${id}`).then((data) => data?.coupon ?? null);
}

export function createCoupon(payload) {
  return apiPost('/coupons', payload).then((data) => data?.coupon ?? null);
}

export function updateCoupon(id, payload) {
  return apiPatch(`/coupons/${id}`, payload).then((data) => data?.coupon ?? null);
}

/** Deactivate: `PATCH { isActive: false }` (no dedicated endpoint). */
export function deactivateCoupon(id) {
  return apiPatch(`/coupons/${id}`, { isActive: false }).then((data) => data?.coupon ?? null);
}

/** Reactivate: documented `PATCH { isActive: true }`. */
export function activateCoupon(id) {
  return apiPatch(`/coupons/${id}`, { isActive: true }).then((data) => data?.coupon ?? null);
}

/**
 * Hard delete — refused by the backend once the coupon has been used
 * (`409 COUPON_IN_USE`). Callers reconcile the mirror on success.
 */
export function deleteCoupon(id) {
  return apiDelete(`/coupons/${id}`).then((data) => data ?? null);
}
