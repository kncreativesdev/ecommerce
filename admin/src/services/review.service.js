import { apiDelete, apiGetPage, apiPatch } from '../lib/apiClient.js';

/**
 * Admin review API access — ADMIN-only moderation endpoints (verified:
 * `reviews.routes|controller|service|validation`, API_CONTRACT_MATRIX
 * §2). Every query param below is backend-supported
 * (`adminReviewListQuerySchema` allowlist:
 * page/limit/isApproved/rating/productId/userId/search/sortBy/sortOrder).
 * No invented params, no invented moderation enum.
 *
 * - `GET /reviews/admin` → `200 { reviews[] } + meta { page, limit,
 *   total, totalPages }`. Each row is the safe review plus a `customer`
 *   brief (`id, email, firstName, lastName` — never hashes/tokens), a
 *   `product` brief, and an `orderItem` link (`id, orderId`). Filters:
 *   `isApproved` (`"true"`/`"false"` strings), `rating` (1–5), exact
 *   `productId`/`userId`, `search` (review title/comment, product name,
 *   reviewer email/name substring), `sortBy` (`createdAt`), `sortOrder`.
 *   Defaults: page 1, limit 20 (max 100), newest first.
 * - `PATCH /reviews/admin/:id { isApproved }` → `200 { review }`.
 *   `true` approves, `false` rejects back to pending — rejected rows stay
 *   stored and remain listed under `isApproved=false` (rejection is never
 *   deletion). Unknown ids → `404 REVIEW_NOT_FOUND`.
 * - `DELETE /reviews/admin/:id` → `200 { id, message }`. Hard delete of
 *   the review row only — order records are never touched. Repeat ids →
 *   `404 REVIEW_NOT_FOUND`.
 *
 * The moderation model is the actual `isApproved` boolean. There is no
 * public review listing or aggregate endpoint: moderation state is
 * authoritative but not yet consumed by any customer surface.
 */
export function fetchReviewsAdmin({
  page = 1,
  limit = 20,
  isApproved,
  rating,
  productId,
  userId,
  search,
  sortBy = 'createdAt',
  sortOrder = 'desc',
} = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('sortBy', sortBy);
  params.set('sortOrder', sortOrder);
  if (isApproved === true || isApproved === 'true') params.set('isApproved', 'true');
  if (isApproved === false || isApproved === 'false') params.set('isApproved', 'false');
  if (rating !== undefined && rating !== null && rating !== '') params.set('rating', String(rating));
  if (productId) params.set('productId', productId);
  if (userId) params.set('userId', userId);
  if (search && search.trim() !== '') params.set('search', search.trim());
  // `apiGetPage` (not `apiGet`): the list envelope carries pagination in
  // top-level `meta`, which the plain data-only helper drops.
  return apiGetPage(`/reviews/admin?${params.toString()}`).then(({ data, meta }) => ({
    reviews: Array.isArray(data?.reviews) ? data.reviews : [],
    pagination: meta ?? { page, limit, total: 0, totalPages: 1 },
  }));
}

export function setReviewApproved(id, isApproved) {
  return apiPatch(`/reviews/admin/${id}`, { isApproved }).then((data) => data?.review ?? null);
}

export function deleteReviewAdmin(id) {
  return apiDelete(`/reviews/admin/${id}`);
}
