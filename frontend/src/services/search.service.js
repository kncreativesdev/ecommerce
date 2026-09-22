/**
 * Search suggestion seam.
 *
 * No backend search endpoint exists — search is client-side over the
 * `GET /products` cache (API_INTEGRATION.md §7, "DO NOT INVENT" §15.7).
 * This module is the single seam where live suggestions will plug in once
 * the catalog cache milestone lands. Until then it resolves an empty list
 * and the search panel renders honest category shortcuts instead of
 * fabricated suggestions. Never invent suggestion data here.
 *
 * @returns {Promise<Array>} always `[]` for now
 */
export async function fetchSearchSuggestions() {
  return [];
}
