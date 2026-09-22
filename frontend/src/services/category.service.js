import { apiGet } from '../lib/apiClient.js';

/**
 * Category/taxonomy API access — the ONLY place that calls category
 * endpoints. Thin wrappers over DOCUMENTED backend routes
 * (API_INTEGRATION.md §5, backend API_CONTRACT_MATRIX):
 *
 * - `GET /categories` (PUBLIC) → bare array, active only. Fields include
 *   `id, name, slug, description, image, parentId, sortOrder`.
 * - `GET /categories/:id` (PUBLIC) → `data.category`.
 *
 * Deliberately NOT exposed here:
 * - subcategory listing/detail — NO such endpoint is documented. Hierarchy
 *   is derived client-side from `parentId` (see `utils/categoryAdapter.js`).
 * - `POST/PATCH/DELETE /categories` (ADMIN-only) — the admin milestones
 *   will add these alongside the auth store; the storefront never calls
 *   admin writes. No methods are stubbed for them.
 *
 * Services contain no React state; stores call these functions.
 */
export function fetchCategories() {
  return apiGet('/categories');
}

export function fetchCategoryById(id) {
  return apiGet(`/categories/${id}`);
}
