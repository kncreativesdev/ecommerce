import { discountPercentFromStrings, formatINR } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

/**
 * Single price renderer for the whole storefront. Takes backend decimal
 * strings (`price`, optional `compareAtPrice` MRP claim) and renders the
 * current price, strikethrough MRP, and a derived `% off` badge. Prices
 * are display-only — never arithmetic for checkout.
 */
export function PriceBlock({ price, compareAtPrice, size = 'md', className }) {
  const discount = discountPercentFromStrings(price, compareAtPrice);
  const large = size === 'lg';

  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', className)}>
      <span
        className={cn(
          'font-bold tabular-nums text-foreground',
          large ? 'text-2xl leading-7' : 'text-base leading-6',
        )}
      >
        {formatINR(price)}
      </span>
      {compareAtPrice && discount !== null ? (
        <>
          <span className="text-sm tabular-nums text-muted-foreground line-through">
            {formatINR(compareAtPrice)}
          </span>
          <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-foreground">
            {discount}% off
          </span>
        </>
      ) : null}
    </div>
  );
}
