import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, Trash2 } from 'lucide-react';
import { formatINR } from '../../lib/format.js';

/**
 * Cart summary: SERVER values only (`itemCount`, `subtotal` verbatim —
 * never client arithmetic), COD note, checkout CTA, continue shopping.
 * If the payload ever carries only a subtotal, only the subtotal renders.
 */
export function CartSummary({ cart, bulkPending, onClear }) {
  return (
    <aside aria-label="Order summary" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-bold text-foreground">Order summary</h2>
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">
            Items ({cart.itemCount})
          </dt>
          <dd className="font-semibold tabular-nums text-foreground">{formatINR(cart.subtotal)}</dd>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2">
          <dt className="font-bold text-foreground">Subtotal</dt>
          <dd className="text-lg font-extrabold tabular-nums text-foreground">{formatINR(cart.subtotal)}</dd>
        </div>
      </dl>
      <p className="flex items-start gap-2 rounded-xl bg-surface-muted px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
        <Banknote size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
        Cash on Delivery. Taxes and shipping, if any, are confirmed at checkout from server totals.
      </p>
      <Link
        to="/checkout"
        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 hover:no-underline"
      >
        Proceed to checkout
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
      <div className="flex items-center justify-between">
        <Link
          to="/shop"
          className="text-sm font-semibold text-accent-link hover:no-underline"
        >
          Continue shopping
        </Link>
        <button
          type="button"
          onClick={onClear}
          disabled={bulkPending || cart.items.length === 0}
          className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-muted-foreground transition-colors duration-200 hover:text-destructive disabled:cursor-wait disabled:opacity-60"
        >
          <Trash2 size={15} aria-hidden="true" />
          {bulkPending ? 'Clearing…' : 'Clear cart'}
        </button>
      </div>
    </aside>
  );
}
