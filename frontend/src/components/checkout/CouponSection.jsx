import { useState } from 'react';
import { BadgePercent, X } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';
import { useCheckoutStore } from '../../stores/useCheckoutStore.js';
import { validateCoupon } from '../../services/coupons.service.js';
import { formatINR } from '../../lib/format.js';

/**
 * Checkout coupon section (review step). Apply posts ONLY the code to
 * `POST /coupons/validate` — lines come from the caller's cart
 * server-side. The authoritative quote (`discountAmount` et al.) renders
 * as-is; the "estimated total" is display-only subtraction of two server
 * values, explicitly footnoted — order placement re-validates and the
 * backend alone decides the final totals and usage.
 */
export function CouponSection({ disabled = false }) {
  const cartSubtotal = useCartStore((state) => state.cart.subtotal);
  const appliedCoupon = useCheckoutStore((state) => state.appliedCoupon);
  const setAppliedCoupon = useCheckoutStore((state) => state.setAppliedCoupon);
  const clearAppliedCoupon = useCheckoutStore((state) => state.clearAppliedCoupon);

  const [draft, setDraft] = useState('');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  const apply = async (event) => {
    event?.preventDefault();
    const code = draft.trim();
    if (!code || applying || disabled) return;
    setApplying(true);
    setError(null);
    try {
      const quote = await validateCoupon(code);
      if (!quote?.coupon?.code || !quote?.discountAmount) {
        throw new Error('Coupon could not be validated. Please try again.');
      }
      setAppliedCoupon(quote);
      setDraft('');
    } catch (applyError) {
      // Real backend semantics (COUPON_NOT_FOUND / COUPON_EXPIRED /
      // COUPON_INACTIVE / COUPON_MINIMUM_ORDER_NOT_MET /
      // COUPON_NOT_APPLICABLE / COUPON_USAGE_LIMIT_EXCEEDED / …).
      setError(applyError?.message ?? 'Coupon could not be applied. Please try again.');
    } finally {
      setApplying(false);
    }
  };

  const remove = () => {
    clearAppliedCoupon();
    setError(null);
    setDraft('');
  };

  const quote = appliedCoupon;
  const discount = quote?.discountAmount ?? null;
  const subtotalNumber = Number(cartSubtotal);
  const discountNumber = Number(discount);
  const estimated =
    discount !== null && Number.isFinite(subtotalNumber) && Number.isFinite(discountNumber)
      ? (subtotalNumber - discountNumber).toFixed(2)
      : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted/40 p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
        <BadgePercent size={16} aria-hidden="true" />
        Coupon
      </h3>

      {quote?.coupon ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-foreground">
              Applied: <span className="font-mono font-bold">{quote.coupon.code}</span>
            </p>
            <button
              type="button"
              onClick={remove}
              disabled={disabled}
              aria-label={`Remove coupon ${quote.coupon.code}`}
              className="inline-flex min-h-[36px] cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X size={14} aria-hidden="true" />
              Remove
            </button>
          </div>
          <dl className="flex items-center justify-between text-sm">
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="font-bold tabular-nums text-success">−{formatINR(discount)}</dd>
          </dl>
        </div>
      ) : (
        <form onSubmit={apply} className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="coupon-code" className="sr-only">
              Coupon code
            </label>
            <input
              id="coupon-code"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Enter coupon code"
              autoComplete="off"
              disabled={disabled || applying}
              className="min-h-[44px] w-full flex-1 rounded-xl border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={disabled || applying || draft.trim() === ''}
              className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl bg-secondary px-5 text-sm font-semibold text-secondary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {applying ? 'Applying…' : 'Apply'}
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      )}

      {estimated !== null && quote?.coupon ? (
        <dl className="flex items-center justify-between border-t border-border pt-2 text-sm">
          <dt className="text-muted-foreground">Estimated total</dt>
          <dd className="text-base font-extrabold tabular-nums">{formatINR(estimated)}</dd>
        </dl>
      ) : null}
      {quote?.coupon ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Estimate only — the final total is calculated by the server when you place the order.
        </p>
      ) : null}
    </div>
  );
}
