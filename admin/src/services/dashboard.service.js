import { apiGet } from '../lib/apiClient.js';

/**
 * Admin dashboard analytics — ADMIN-only `GET /dashboard/summary`
 * (verified: `dashboard.routes|controller|service|validation`,
 * API_CONTRACT_MATRIX §2). The ONLY query param is the fixed range enum
 * (`today|week|month|year`); date boundaries are computed server-side in
 * UTC, so the admin can never disagree with the backend about what
 * "today" means.
 *
 * Response `data.summary` (all aggregates database-computed, never
 * frontend-summed):
 * - `range, periodStart, periodEnd, generatedAt` (ISO UTC),
 *   `granularity` (`hour|day|month`).
 * - `orders { total, pending, confirmed, processing, shipped, delivered,
 *   cancelled }` — all-time status counts (every received order).
 * - `revenue { total }` — all-time RECOGNIZED revenue: SUM(grandTotal)
 *   over DELIVERED orders whose latest payment is PAID. Cancelled,
 *   in-flight, unpaid, failed, and refunded orders are excluded.
 * - `period { orders, revenue }` — received orders + recognized revenue
 *   inside the selected range.
 * - `buckets[]` — `{ bucketStart, orders, revenue }`, zero-filled across
 *   the full frame (hourly/daily/monthly per range). Zeros are measured
 *   absence, never invented points.
 * - `inventory { tracked, outOfStock, uninitialized }` — actionable
 *   stock snapshot over ACTIVE variants of ACTIVE products.
 */
export const DASHBOARD_RANGES = ['today', 'week', 'month', 'year'];

export function fetchDashboardSummary(range = 'today') {
  const params = new URLSearchParams();
  params.set('range', range);
  return apiGet(`/dashboard/summary?${params.toString()}`).then((data) => data?.summary ?? null);
}
