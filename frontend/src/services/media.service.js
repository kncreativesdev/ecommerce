import { apiGet } from '../lib/apiClient.js';

/**
 * Product media reads — public (API_INTEGRATION §8, verified
 * `media.controller.js` + `media.routes.js` with `mergeParams`):
 * - `GET /products/:productId/images` → bare array of image metadata.
 * - `GET /products/:productId/images/:imageId` → `{ image }` (rarely
 *   needed directly).
 *
 * Image record: `{ filename, storagePath, imageType: "webp", altText,
 * sortOrder, isPrimary }`. Delivery caveat (FRONTEND_SPEC §16): no static
 * file-serving route is documented, so the UI renders
 * `{VITE_MEDIA_BASE_URL}{storagePath}` with a placeholder fallback on
 * load failure. Upload/update/delete are ADMIN-only — no customer UI.
 */
export function fetchProductImages(productId) {
  return apiGet(`/products/${productId}/images`).then((data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.images)) return data.images;
    return [];
  });
}

export function fetchProductImageById(productId, imageId) {
  return apiGet(`/products/${productId}/images/${imageId}`).then(
    (data) => data?.image ?? null,
  );
}

/**
 * Resolve a display URL for an image record. Returns `null` when the
 * record carries no usable path so callers render the placeholder.
 */
export function resolveImageUrl(image, mediaBaseUrl) {
  const storagePath = image?.storagePath ?? image?.url ?? '';
  if (!storagePath || !mediaBaseUrl) return null;
  const base = mediaBaseUrl.endsWith('/') ? mediaBaseUrl.slice(0, -1) : mediaBaseUrl;
  const path = storagePath.startsWith('/') ? storagePath : `/${storagePath}`;
  return `${base}${path}`;
}

/**
 * Browser URL for a category/subcategory `image` reference.
 *
 * Backend contract (`categories.service.js` `uploadCategoryImage`): the
 * `image` field is a plain ≤500-char string reference; files written by
 * `POST /categories/:id/image` live under the managed `categories/`
 * storage prefix (e.g. `categories/<id>/<uuid>.webp`) and are served
 * statically by the API server — so the reference MUST be joined with
 * `VITE_MEDIA_BASE_URL`, exactly like product `storagePath`. Returns
 * `null` for missing/blank references so callers render the Lucide
 * fallback icon instead of a broken image. Foreign (non-managed)
 * references are still resolved the same way — never deleted, only
 * displayed — mirroring the admin `resolveCategoryImageUrl`.
 */
export function resolveCategoryImageUrl(image, mediaBaseUrl) {
  if (typeof image !== 'string' || image.trim() === '' || !mediaBaseUrl) return null;
  const base = mediaBaseUrl.endsWith('/') ? mediaBaseUrl.slice(0, -1) : mediaBaseUrl;
  const path = image.startsWith('/') ? image : `/${image}`;
  return `${base}${path}`;
}
