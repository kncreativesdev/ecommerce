import { apiGet, apiGetPage, apiPatch, apiPost } from '../lib/apiClient.js';

/**
 * Admin inventory API access — DOCUMENTED endpoints only (verified:
 * `inventory.routes|controller|service|validation`, mounted at
 * `/products/:productId/variants/:variantId/inventory`, ADMIN-only).
 *
 * Variant-level ONLY — no product-level inventory endpoint exists.
 * - `GET` → `200 { inventory }`; no record yet → `404 INVENTORY_NOT_FOUND`
 *   (callers treat this as the honest "Not initialized" state, not a crash).
 * - `POST` initialize-once → `201 { inventory }`. Strict body:
 *   `{ quantity: int 0..2147483647, note?: string ≤1000|null }`.
 *   Repeat → `409 INVENTORY_ALREADY_EXISTS`.
 * - `PATCH` adjust → `200 { inventory }`. Strict body: `{ quantity: <delta
 *   int ≠ 0, |delta| ≤ 2147483647>, note? }` — the field carries the DELTA,
 *   not the new total. Negative result → `409 INSUFFICIENT_STOCK`;
 *   overflow → `422 VALIDATION_ERROR`; missing record → `404
 *   INVENTORY_NOT_FOUND`.
 *
 * Record shape: `{ id, variantId, quantity, reservedQuantity,
 * availableQuantity, createdAt, updatedAt }`. The admin displays `quantity`
 * only — reserved/available/ledger concepts are intentionally not surfaced.
 */
export function fetchVariantInventory(productId, variantId) {
  return apiGet(`/products/${productId}/variants/${variantId}/inventory`).then(
    (data) => data?.inventory ?? null,
  );
}

export function initializeInventory(productId, variantId, { quantity, note }) {
  const body = { quantity };
  if (typeof note === 'string' && note.trim() !== '') {
    body.note = note.trim();
  }
  return apiPost(`/products/${productId}/variants/${variantId}/inventory`, body).then(
    (data) => data?.inventory ?? null,
  );
}

export function adjustInventory(productId, variantId, { quantity, note }) {
  const body = { quantity };
  if (typeof note === 'string' && note.trim() !== '') {
    body.note = note.trim();
  }
  return apiPatch(`/products/${productId}/variants/${variantId}/inventory`, body).then(
    (data) => data?.inventory ?? null,
  );
}

/**
 * Cross-variant stock list — ADMIN-only `GET /inventory` (verified:
 * `inventory.admin.routes`, API_CONTRACT_MATRIX §2). Every param is
 * backend-supported (`adminInventoryListQuerySchema` allowlist:
 * page/limit/search/stock/active/sortBy/sortOrder). No invented params.
 *
 * - `search` matches SKU, variant name, or product name (literal
 *   substring). `stock`: `in` (available > 0) / `out` (available ≤ 0 or
 *   no stock record — either way the variant cannot be purchased).
 *   `active` filters the VARIANT flag (`"true"`/`"false"` strings).
 *   `sortBy`: `sku|createdAt|updatedAt`.
 * - Rows: `{ product { id, name, slug, isActive }, variant { id,
 *   productId, sku, name, price, isActive, createdAt }, inventory |
 *   null }`. A null inventory is the honest "Not initialized" state —
 *   never rendered as zero. `200 { items[] } + meta`.
 */
export function fetchInventoryList({
  page = 1,
  limit = 20,
  search,
  stock,
  active,
  sortBy = 'createdAt',
  sortOrder = 'desc',
} = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('sortBy', sortBy);
  params.set('sortOrder', sortOrder);
  if (search && search.trim() !== '') params.set('search', search.trim());
  if (stock === 'in' || stock === 'out') params.set('stock', stock);
  if (active === true || active === 'true') params.set('active', 'true');
  if (active === false || active === 'false') params.set('active', 'false');
  // `apiGetPage` (not `apiGet`): the list envelope carries pagination in
  // top-level `meta`, which the plain data-only helper drops.
  return apiGetPage(`/inventory?${params.toString()}`).then(({ data, meta }) => ({
    items: Array.isArray(data?.items) ? data.items : [],
    pagination: meta ?? { page, limit, total: 0, totalPages: 1 },
  }));
}

/**
 * Stock ledger history — ADMIN-only
 * `GET /products/:productId/variants/:variantId/inventory/transactions`
 * (`inventoryTransactionsQuerySchema`: page/limit). Newest first.
 * Rows: `{ id, variantId, quantity (signed delta), type
 * (INITIAL_STOCK|ORDER|ORDER_CANCELLED|RESTOCK|DAMAGED|ADJUSTMENT),
 * referenceType (ADMIN|ORDER), referenceId, note, createdAt }`.
 * `200 { transactions[] } + meta`. Unknown variant → `404
 * PRODUCT_VARIANT_NOT_FOUND` (history never fabricates a variant).
 */
export function fetchInventoryTransactions(productId, variantId, { page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  return apiGetPage(
    `/products/${productId}/variants/${variantId}/inventory/transactions?${params.toString()}`,
  ).then(({ data, meta }) => ({
    transactions: Array.isArray(data?.transactions) ? data.transactions : [],
    pagination: meta ?? { page, limit, total: 0, totalPages: 1 },
  }));
}
