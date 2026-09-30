import { apiGet, apiGetPage } from '../lib/apiClient.js';

/**
 * Admin return-request API access — ADMIN-only `/returns` endpoints
 * (verified: `returns.admin.routes|controller|service|validation`):
 *
 * - `GET /returns` → `200 { returns[] } + meta { page, limit, total,
 *   totalPages }`. Query (explicit allowlist only): `?status=` (return
 *   status enum), `?search=` (order-number / customer-email/name
 *   substring), `?page=` (default 1), `?limit=` (default 20, max 100).
 *   Newest first.
 * - `GET /returns/:id` → `200 { returnRequest }` with embedded `customer`
 *   brief, `order` summary, and `history[]`; unknown ids →
 *   `404 RETURN_NOT_FOUND`.
 *
 * No status-mutation endpoint exists: the backend workflow defines
 * creation + history only, so this surface is intentionally read-only.
 * Return shape: `{ id, orderId, status, reason, details, createdAt,
 * updatedAt, customer: { id, email, firstName, lastName, phone },
 * order: { id, orderNumber, status, grandTotal, createdAt },
 * history?: [{ id, status, actorId, createdAt }] }`.
 */
export function fetchReturnsAdmin({ page = 1, limit = 20, status, search } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (status) params.set('status', status);
  if (search && search.trim() !== '') params.set('search', search.trim());
  const query = params.toString();
  // `apiGetPage` (not `apiGet`): the list envelope carries pagination in
  // top-level `meta`, which the plain data-only helper drops.
  return apiGetPage(`/returns${query ? `?${query}` : ''}`).then(({ data, meta }) => ({
    returns: Array.isArray(data?.returns) ? data.returns : [],
    pagination: meta ?? { page, limit, total: 0, totalPages: 1 },
  }));
}

export function fetchReturnAdmin(id) {
  return apiGet(`/returns/${id}`).then((data) => data?.returnRequest ?? null);
}
