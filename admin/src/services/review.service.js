import { apiGetPage } from '../lib/apiClient.js';

/**
 * Admin review API access — ADMIN-only READ-ONLY listing (verified:
 * `reviews.routes|controller|service|validation`, API_CONTRACT_MATRIX
 * §2). Every query param below is backend-supported
 * (`adminReviewListQuerySchema` allowlist:
 * page/limit/isApproved/rating/productId/userId/search/sortBy/sortOrder).
 * No invented params.
 *
 * - `GET /reviews/admin` → `200 { reviews[] } + meta { page, limit,
 *   total, totalPages }`. Each row is the safe review plus a `customer`
 *   brief (`id, email, firstName, lastName` — never hashes/tokens), a
 *   `product` brief, and an `orderItem` link (`id, orderId`). Filters:
 *   `isApproved` (`"true"`/`"false"` strings), `rating` (1–5), exact
 *   `productId`/`userId`, `search` (review title/comment, product name,
 *   reviewer email/name substring), `sortBy` (`createdAt`), `sortOrder`.
 *   Defaults: page 1, limit 20 (max 100), newest first.
 *
 * There are NO admin review mutation endpoints by design (no approve,
 * reject, edit, delete, or status change): customer reviews are visible
 * without approval and the admin surface is strictly view-only.
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
