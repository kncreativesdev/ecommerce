import { formatINR } from '../lib/format.js';

/**
 * Coupon presentation helpers. All states derive from actual backend
 * fields (`isActive`, `startsAt`, `expiresAt`) plus the clock — no
 * persisted lifecycle enum exists server-side, so nothing here is stored.
 *
 * Derived availability (matches the checkout validator's checks):
 * - `INACTIVE` — `isActive` is false (validator rejects `COUPON_INACTIVE`).
 * - `SCHEDULED` — active but `startsAt` is in the future.
 * - `EXPIRED` — `expiresAt` is in the past (shown regardless of the
 *   active flag: an expired window never validates).
 * - `ACTIVE` — active and inside the validity window (open-ended when a
 *   bound is null).
 */

export const COUPON_SCOPES = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export const DISCOUNT_TYPES = [
  { value: 'PERCENTAGE', label: 'Percentage (%)' },
  { value: 'FIXED', label: 'Fixed amount (₹)' },
];

export function couponDerivedStatus(coupon, now = new Date()) {
  if (!coupon?.isActive) return 'INACTIVE';
  const startsAt = coupon.startsAt ? new Date(coupon.startsAt) : null;
  const expiresAt = coupon.expiresAt ? new Date(coupon.expiresAt) : null;
  if (startsAt && !Number.isNaN(startsAt.getTime()) && now < startsAt) return 'SCHEDULED';
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && now > expiresAt) return 'EXPIRED';
  return 'ACTIVE';
}

export const COUPON_STATUS_TONES = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  SCHEDULED: 'info',
  EXPIRED: 'warning',
};

export function couponStatusLabel(status) {
  if (status === 'ACTIVE') return 'Active';
  if (status === 'INACTIVE') return 'Inactive';
  if (status === 'SCHEDULED') return 'Scheduled';
  if (status === 'EXPIRED') return 'Expired';
  return '—';
}

/** Display-only discount summary from server-returned strings (no math). */
export function couponDiscountSummary(coupon) {
  if (!coupon) return '—';
  if (coupon.discountType === 'PERCENTAGE') {
    const percent = Number(coupon.discountValue);
    const base = Number.isFinite(percent) ? `${percent}% off` : 'Percentage off';
    return coupon.maximumDiscountAmount ? `${base} · capped at ${formatINR(coupon.maximumDiscountAmount)}` : base;
  }
  if (coupon.discountType === 'FIXED') {
    return `${formatINR(coupon.discountValue)} off`;
  }
  return '—';
}

/** Display-only usage summary from authoritative counts (never computed). */
export function couponUsageSummary(coupon) {
  if (!coupon) return '—';
  const used = Number(coupon.usedCount) || 0;
  if (coupon.usageLimit === null || coupon.usageLimit === undefined) {
    return `Unlimited · ${used} used`;
  }
  return `${used} / ${coupon.usageLimit} used`;
}

export function couponProductIds(coupon) {
  if (!Array.isArray(coupon?.products)) return [];
  return coupon.products.map((link) => link?.productId).filter(Boolean);
}

/**
 * `datetime-local` ↔ ISO conversions. Inputs carry local wall time (no
 * offset); the backend stores UTC. `toISOString()` on submit and local
 * `Intl` rendering on display keep the round-trip explicit — no date
 * library, minute precision (seconds are truncated by the control).
 */
export function toLocalInputValue(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInputValue(localValue) {
  if (!localValue) return null;
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
