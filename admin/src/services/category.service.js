import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm } from '../lib/apiClient.js';

/**
 * Admin taxonomy API access — DOCUMENTED category endpoints only
 * (verified: `categories.routes|controller|service`, API_CONTRACT_MATRIX):
 *
 * - `GET /categories` (public default) → bare array, ACTIVE ONLY.
 *   `?status=active|inactive|all` selects the scope; `inactive`/`all`
 *   require ADMIN (else 401/403), invalid values → `422`. Reactivation is
 *   `PATCH { isActive: true }` — there is no dedicated restore endpoint.
 * - `GET /categories/:id` → `{ category }`; `?status=all` (ADMIN) reads
 *   inactive rows; otherwise `404 CATEGORY_NOT_FOUND`.
 * - `POST /categories` (ADMIN) → `201 { category }`. Writable:
 *   `name*` (1–150), `slug?` (≤180, auto-derived from name when omitted),
 *   `description?` (nullable), `image?` (≤500, nullable),
 *   `parentId?` (nullable; `404 CATEGORY_PARENT_NOT_FOUND` when unknown;
 *   `null` promotes a subcategory to top-level),
 *   `isActive?` (default true), `sortOrder?` (int ≥ 0, default 0).
 *   Unknown fields → `422`. Duplicate slug → `409 CATEGORY_SLUG_EXISTS`.
 * - `PATCH /categories/:id` (ADMIN) → partial subset of the same fields;
 *   empty object → `422 CATEGORY_UPDATE_INVALID`; self-parent →
 *   `422 CATEGORY_SELF_PARENT`; ancestor cycle → `422 CATEGORY_CYCLE`.
 * - `DELETE /categories/:id` (ADMIN) → SOFT-DEACTIVATES (row stays,
 *   `isActive=false`, disappears from public reads). Repeat/other
 *   ids → `404`.
 * - `POST /categories/:id/image` (ADMIN, multipart `image`: JPEG/PNG/WebP
 *   ≤5MB, WebP output stored under `categories/<id>/`) → `200 { category }`
 *   with `image` set to the new storage reference; replaces the previous
 *   managed file. Works for inactive rows.
 * - `DELETE /categories/:id/image` (ADMIN) → `200 { category }`,
 *   idempotent; removes the managed file and nulls `image`.
 *
 * Hierarchy representation: `parentId = null` → top-level Category;
 * `parentId = <id>` → Subcategory of that parent. There are NO dedicated
 * `/subcategories` endpoints — subcategories ARE categories with a parent.
 * The admin UI builds the tree client-side from the flat list.
 */
export function fetchCategories(status = 'active') {
  const query = status && status !== 'active' ? `?status=${encodeURIComponent(status)}` : '';
  return apiGet(`/categories${query}`);
}

export function fetchCategoryById(id, scope = 'active') {
  const query = scope && scope !== 'active' ? `?status=${encodeURIComponent(scope)}` : '';
  return apiGet(`/categories/${id}${query}`).then((data) => data?.category ?? null);
}

export function createCategory(payload) {
  return apiPost('/categories', payload).then((data) => data?.category ?? null);
}

export function updateCategory(id, payload) {
  return apiPatch(`/categories/${id}`, payload).then((data) => data?.category ?? null);
}

/** Documented semantics: soft-deactivate (not a hard delete). */
export function deactivateCategory(id) {
  return apiDelete(`/categories/${id}`).then((data) => data?.category ?? null);
}

/** Reactivate: documented `PATCH { isActive: true }` (no dedicated endpoint). */
export function activateCategory(id) {
  return apiPatch(`/categories/${id}`, { isActive: true }).then(
    (data) => data?.category ?? null,
  );
}

/** Category image upload (ADMIN, multipart file field `image`). */
export function uploadCategoryImage(id, file) {
  const formData = new FormData();
  formData.append('image', file);
  return apiPostForm(`/categories/${id}/image`, formData).then(
    (data) => data?.category ?? null,
  );
}

/** Category image removal (ADMIN, idempotent). */
export function deleteCategoryImage(id) {
  return apiDelete(`/categories/${id}/image`).then((data) => data?.category ?? null);
}
