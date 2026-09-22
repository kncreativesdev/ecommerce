/**
 * Display-only formatting helpers. Money arrives as backend decimal strings
 * and is NEVER used for checkout arithmetic client-side — formatting here
 * is presentation only (FRONTEND_ARCHITECTURE.md §4).
 */

/** Format a backend decimal-string price as INR (`en-IN`). */
export function formatINR(decimalString) {
  const amount = Number(decimalString);
  if (!Number.isFinite(amount)) return '';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Discount percent derived from real backend pricing
 * (`% = (compareAtPrice − price) / compareAtPrice`, rounded).
 * Returns `null` when no MRP claim exists — never fabricate one.
 */
export function discountPercentFromStrings(price, compareAtPrice) {
  const current = Number(price);
  const mrp = Number(compareAtPrice);
  if (!Number.isFinite(current) || !Number.isFinite(mrp) || mrp <= 0 || current >= mrp) {
    return null;
  }
  return Math.round(((mrp - current) / mrp) * 100);
}

/** Short locale date for order/product timestamps. */
export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}
