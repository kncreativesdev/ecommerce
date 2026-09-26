import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/apiClient.js';

/**
 * Reviews API access — verified-purchase only, owner-scoped
 * (API_INTEGRATION §12, verified `reviews.routes|validation`):
 * - `POST /reviews { orderItemId, rating 1–5, title?, comment? }` → `201`.
 *   `productId` is derived server-side — never sent. `409` on repeats.
 * - `GET /reviews/me` → own reviews, newest first.
 * - `GET /reviews/product/:productId` → public approved reviews for the
 *   PDP (no auth): `{ id, productId, rating, title, comment, author,
 *   createdAt }[]`. No private customer data.
 * - `GET /reviews/:id` → owner-scoped single review.
 * - `PATCH /reviews/:id` → non-empty subset of `{ rating, title, comment }`.
 * - `DELETE /reviews/:id` → hard delete. Repeat → `404`.
 */
function cleanReviewFields({ rating, title, comment }) {
  const body = {};
  if (rating !== undefined) body.rating = rating;
  if (title !== undefined) body.title = title?.trim() ? title.trim() : null;
  if (comment !== undefined) body.comment = comment?.trim() ? comment.trim() : null;
  return body;
}

export function createReview({ orderItemId, rating, title, comment }) {
  return apiPost('/reviews', { orderItemId, ...cleanReviewFields({ rating, title, comment }) }).then(
    (data) => data?.review ?? data?.reviews ?? null,
  );
}

export function fetchMyReviews() {
  return apiGet('/reviews/me').then((data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.reviews)) return data.reviews;
    return [];
  });
}

export function fetchProductReviews(productId) {
  if (!productId) return Promise.resolve([]);
  return apiGet(`/reviews/product/${productId}`).then((data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.reviews)) return data.reviews;
    return [];
  });
}

export function fetchReviewById(id) {
  return apiGet(`/reviews/${id}`).then((data) => data?.review ?? null);
}

export function updateReview(id, { rating, title, comment }) {
  return apiPatch(`/reviews/${id}`, cleanReviewFields({ rating, title, comment })).then(
    (data) => data?.review ?? null,
  );
}

export function deleteReview(id) {
  return apiDelete(`/reviews/${id}`);
}
