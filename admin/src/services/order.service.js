import { apiGet, apiGetPage, apiPatch } from '../lib/apiClient.js';

/**
 * Admin order API access — ADMIN-only `/orders/admin*` endpoints (verified:
 * `orders.routes|controller|service|validation`, API_CONTRACT_MATRIX §2).
 * Every query param below is backend-supported (`adminOrderListQuerySchema`
 * allowlist: page/limit/status/paymentStatus/search/from/to/sortBy/sortOrder).
 * No invented params are ever sent.
 *
 * - `GET /orders/admin` → `200 { orders[] } + meta { page, limit, total,
 *   totalPages }`. Filters: `status` (OrderStatus), `paymentStatus`
 *   (matches orders having a payment in that state), `search` (order
 *   number / item SKU / customer email / first / last name substring),
 *   `from`/`to` (ISO-8601 creation bounds), `sortBy`
 *   (`createdAt|grandTotal`), `sortOrder` (`asc|desc`). Defaults:
 *   page 1, limit 20 (max 100), newest first.
 * - `GET /orders/admin/:id` → `200 { order }` (any order + `customer`
 *   brief `{ id, email, firstName, lastName, phone }`). Unknown ids →
 *   `404 ORDER_NOT_FOUND`.
 * - `PATCH /orders/admin/:id/status { status, note? }` → `200 { order }`.
 *   Forward-only machine (backend `ORDER_STATUS_TRANSITIONS`):
 *   PENDING→CONFIRMED|CANCELLED, CONFIRMED→PROCESSING|CANCELLED,
 *   PROCESSING→DISPATCHED|CANCELLED, DISPATCHED→IN_TRANSIT,
 *   IN_TRANSIT→ARRIVED_IN_CITY, ARRIVED_IN_CITY→OUT_FOR_DELIVERY,
 *   OUT_FOR_DELIVERY→DELIVERED, DELIVERED→COMPLETED, COMPLETED/CANCELLED
 *   terminal, SHIPPED (legacy)→IN_TRANSIT|DELIVERED compat only.
 *   Optional `note` (≤500 chars) is recorded on the statusHistory row.
 *   Same-status → `409 ORDER_STATUS_UNCHANGED`; illegal moves → `409
 *   ORDER_INVALID_STATUS_TRANSITION` with an explanatory message.
 *   Responses include authoritative `statusHistory[]` (oldest-first:
 *   `{ id, status, previousStatus, note, createdAt }`; legacy orders carry
 *   `[]` — never invented client-side). `CANCELLED` atomically restores
 *   checkout-decremented stock with `ORDER_CANCELLED` ledger rows.
 *   Cancellation IS this endpoint with `{ status: 'CANCELLED' }` — there
 *   is no separate cancel route.
 * - `PATCH /orders/admin/:id/payment { status }` → `200 { order }`.
 *   Status-only mutation of the latest payment row (backend
 *   `PAYMENT_STATUS_TRANSITIONS`); illegal moves → `409
 *   PAYMENT_INVALID_STATUS_TRANSITION`. No gateway exists: `REFUNDED`
 *   records a manual refund, it does not process a payout.
 *
 * Totals are server-authoritative strings — the admin renders them, never
 * recomputes them. The admin never mutates inventory directly.
 */
export function fetchOrdersAdmin({
  page = 1,
  limit = 20,
  status,
  paymentStatus,
  search,
  city,
  state,
  from,
  to,
  sortBy = 'createdAt',
  sortOrder = 'desc',
} = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('sortBy', sortBy);
  params.set('sortOrder', sortOrder);
  if (status) params.set('status', status);
  if (paymentStatus) params.set('paymentStatus', paymentStatus);
  if (search && search.trim() !== '') params.set('search', search.trim());
  if (city && city.trim() !== '') params.set('city', city.trim());
  if (state && state.trim() !== '') params.set('state', state.trim());
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  // `apiGetPage` (not `apiGet`): the list envelope carries pagination in
  // top-level `meta`, which the plain data-only helper drops (same flaw
  // fixed for coupons — without this, totals stay 0 and pages vanish).
  return apiGetPage(`/orders/admin?${params.toString()}`).then(({ data, meta }) => ({
    orders: Array.isArray(data?.orders) ? data.orders : [],
    pagination: meta ?? { page, limit, total: 0, totalPages: 1 },
  }));
}

export function fetchOrderAdmin(id) {
  return apiGet(`/orders/admin/${id}`).then((data) => data?.order ?? null);
}

export function updateOrderStatus(id, status, note) {
  const body = { status };
  if (typeof note === 'string' && note.trim() !== '') {
    body.note = note.trim().slice(0, 500);
  }
  return apiPatch(`/orders/admin/${id}/status`, body).then((data) => data?.order ?? null);
}

export function bulkUpdateOrderStatus(orderIds, status, note) {
  const body = { orderIds, status };
  if (typeof note === 'string' && note.trim() !== '') {
    body.note = note.trim().slice(0, 500);
  }
  return apiPatch('/orders/admin/bulk-status', body).then((data) => data?.orders ?? []);
}

export function updateOrderPaymentStatus(id, status) {
  return apiPatch(`/orders/admin/${id}/payment`, { status }).then((data) => data?.order ?? null);
}
