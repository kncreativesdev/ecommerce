import { apiDelete, apiGet, apiPatch, apiPostForm } from '../lib/apiClient.js';
import { env } from '../config/env.js';

/**
 * Admin product-media API access — DOCUMENTED endpoints only (verified:
 * `media.routes|controller|service|validation`, mergeParams router):
 *
 * - `GET /products/:productId/images` (public) → bare array of image
 *   metadata. `404 PRODUCT_NOT_FOUND` when the product is missing/inactive.
 * - `POST /products/:productId/images` (ADMIN, multipart) → `201 { image }`.
 *   Single file in field `image`; JPEG/PNG/WebP (mime + extension), ≤5MB
 *   (`413 MEDIA_FILE_TOO_LARGE`), dimensions ≤8000px, stored as WebP.
 *   Optional text metadata: `variantId?`, `altText?` (≤255),
 *   `sortOrder?` (int ≥ 0), `isPrimary?` (`"true"`/`"false"` strings).
 * - `PATCH .../images/:imageId` (ADMIN, JSON) → `200 { image }`. Subset of
 *   `{ variantId, altText, sortOrder, isPrimary }`; empty object → `422
 *   MEDIA_UPDATE_INVALID`.
 * - `DELETE .../images/:imageId` (ADMIN) → `200 { id, message }` HARD
 *   DELETE (row + file). Repeat/unknown ids → `404 MEDIA_NOT_FOUND`.
 *
 * Image record: `{ id, productId, variantId, filename, storagePath,
 * imageType: "webp", altText, sortOrder, isPrimary, createdAt, updatedAt }`.
 * Delivery: uploaded files under `storage/uploads` are served statically by
 * the API server — resolve browser URLs with `resolveImageUrl` (base +
 * `storagePath`). Callers MUST still render the placeholder fallback when
 * resolution returns `null` (see `resolveImageUrl`).
 */

export const MEDIA_MAX_FILE_SIZE = 5 * 1024 * 1024;
export const MEDIA_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MEDIA_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

export function fetchProductImages(productId) {
  return apiGet(`/products/${productId}/images`).then((data) =>
    Array.isArray(data) ? data : [],
  );
}

/**
 * Upload one image file with optional metadata. `meta` fields that are
 * blank/undefined are OMITTED (never sent as empty strings).
 */
export function uploadProductImage(productId, { file, altText, sortOrder, isPrimary, variantId }) {
  const formData = new FormData();
  formData.append('image', file);
  if (typeof altText === 'string' && altText.trim() !== '') {
    formData.append('altText', altText.trim());
  }
  if (sortOrder !== undefined && sortOrder !== null && sortOrder !== '') {
    formData.append('sortOrder', String(sortOrder));
  }
  if (isPrimary === true) {
    formData.append('isPrimary', 'true');
  }
  if (typeof variantId === 'string' && variantId.trim() !== '') {
    formData.append('variantId', variantId.trim());
  }
  return apiPostForm(`/products/${productId}/images`, formData).then(
    (data) => data?.image ?? null,
  );
}

/** Metadata-only update (JSON, file never sent here). */
export function updateImageMetadata(productId, imageId, patch) {
  return apiPatch(`/products/${productId}/images/${imageId}`, patch).then(
    (data) => data?.image ?? null,
  );
}

export function deleteProductImage(productId, imageId) {
  return apiDelete(`/products/${productId}/images/${imageId}`);
}

/**
 * Centralized display-URL resolution (single place that joins the media
 * base with a backend `storagePath`). Returns `null` when unusable so
 * callers render the placeholder — never an external/invented URL.
 */
export function resolveImageUrl(image, mediaBaseUrl = env.mediaBaseUrl) {
  const storagePath = image?.storagePath ?? '';
  if (!storagePath || !mediaBaseUrl) return null;
  const base = mediaBaseUrl.endsWith('/') ? mediaBaseUrl.slice(0, -1) : mediaBaseUrl;
  const path = storagePath.startsWith('/') ? storagePath : `/${storagePath}`;
  return `${base}${path}`;
}

/**
 * Category `image` values are plain ≤500-char string references. Files
 * written by `POST /categories/:id/image` live under the managed
 * `categories/` storage prefix — only those are safe to treat as
 * backend-hosted files (foreign/legacy references are never deleted).
 */
export function isManagedCategoryImage(value) {
  return typeof value === 'string' && value.startsWith('categories/');
}

/** Browser URL for a category `image` reference (`null` when unusable). */
export function resolveCategoryImageUrl(image, mediaBaseUrl = env.mediaBaseUrl) {
  if (typeof image !== 'string' || image.trim() === '' || !mediaBaseUrl) return null;
  const base = mediaBaseUrl.endsWith('/') ? mediaBaseUrl.slice(0, -1) : mediaBaseUrl;
  const path = image.startsWith('/') ? image : `/${image}`;
  return `${base}${path}`;
}
