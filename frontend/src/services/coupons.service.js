import { apiPost } from '../lib/apiClient.js';

/**
 * Customer coupon API access (verified `coupons.controller|service`):
 *
 * - `POST /coupons/validate { code }` (authenticated, any role) → `200
 *   { coupon, discountAmount, eligibleSubtotal, orderSubtotal }`. Lines
 *   are read from the CALLER'S cart server-side — the client sends only
 *   the code, never product/price data. Unknown codes → `404
 *   COUPON_NOT_FOUND`; inactive/not-yet-valid/expired →
 *   `422 COUPON_*`; exhausted usage → `409 COUPON_USAGE_LIMIT_EXCEEDED`;
 *   inapplicable products / unmet minimum →
 *   `422 COUPON_NOT_APPLICABLE` / `COUPON_MINIMUM_ORDER_NOT_MET`.
 * - Checkout application is `POST /orders { ..., couponCode? }` (see
 *   `orders.service`): the backend re-validates at order time, writes the
 *   `discountTotal` snapshot, charges the discounted total, and consumes
 *   usage atomically. The quote below is a preview, never order truth.
 *
 * Amounts arrive as `"xx.xx"` strings for display only.
 */
export function validateCoupon(code) {
  return apiPost('/coupons/validate', { code }).then((data) => data ?? null);
}
