import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { ProductImage } from '../catalog/ProductImage.jsx';
import { resolveImageUrl } from '../../services/media.service.js';
import { env } from '../../config/env.js';
import { formatINR } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

/**
 * One cart line: product/variant snapshot, unit price, absolute quantity
 * stepper, remove, line total. Server lines render server-computed totals;
 * guest lines render catalog-resolved estimates (see cartAdapter). Lines
 * flagged `unavailable` (variant gone/inactive) show a graceful notice
 * with removal only. Pending mutations disable row controls
 * (double-submit guard).
 *
 * Image: the server-resolved `line.image` snapshot (`{ storagePath,
 * altText }`, variant-aware at fetch time) renders directly. Guest and
 * legacy lines without it fall back to a variant-aware media read
 * (`ProductImage` with the line's `variantId`) — Variant A and Variant B
 * of the same product never collapse into one image.
 */
export function CartLine({ line, pending, unavailable = false, onSetQuantity, onRemove }) {
  const productId = line?.product?.id;
  const title = line?.product?.name ?? 'Product';
  const notAvailable = unavailable || line?.unavailable === true;
  const decrementDisabled = pending || notAvailable || line.quantity <= 1;
  // Backend inventory truth per cart line (authenticated lines carry
  // server `inStock`; guest lines resolve it from the live catalog).
  const stockState =
    line?.inStock !== undefined
      ? Boolean(line.inStock)
      : line?.variant?.inStock !== undefined
        ? Boolean(line.variant.inStock)
        : null;
  const snapshotUrl = resolveImageUrl(
    line?.image?.storagePath ? { storagePath: line.image.storagePath } : null,
    env.mediaBaseUrl,
  );

  return (
    <li className="flex gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
        {snapshotUrl ? (
          <img src={snapshotUrl} alt={line?.image?.altText || title} loading="lazy" className="h-full w-full object-contain" />
        ) : productId ? (
          <ProductImage productId={productId} variantId={line?.variantId ?? line?.variant?.id ?? null} alt={title} />
        ) : (
          <span aria-hidden="true" className="block h-full w-full bg-surface-muted" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {productId ? (
              <Link
                to={`/product/${productId}`}
                className="block truncate text-sm font-semibold text-foreground hover:text-accent hover:no-underline"
              >
                {title}
              </Link>
            ) : (
              <p className="truncate text-sm font-semibold text-foreground">{title}</p>
            )}
            {line?.variant?.name ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{line.variant.name}</p>
            ) : null}
            {line?.variant?.sku ? (
              <p className="truncate text-xs tabular-nums text-muted-foreground">SKU: {line.variant.sku}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onRemove(line.id)}
            disabled={pending}
            aria-label={`Remove ${title} from cart`}
            className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive disabled:cursor-wait disabled:opacity-60"
          >
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>

        <p className="text-xs tabular-nums text-muted-foreground">
          {line.unitPrice !== null && line.unitPrice !== undefined ? `${formatINR(line.unitPrice)} each` : 'Price unavailable'}
        </p>

        {stockState !== null && !notAvailable ? (
          <p
            aria-live="polite"
            className={cn(
              'text-xs font-semibold',
              stockState ? 'text-success' : 'text-destructive',
            )}
          >
            {stockState ? 'In Stock' : 'Out of Stock'}
          </p>
        ) : null}

        {notAvailable ? (
          <p role="note" className="mt-auto rounded-lg bg-surface-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
            No longer available — remove it to continue to checkout.
          </p>
        ) : (
        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          <div className="inline-flex items-center rounded-xl border border-border" role="group" aria-label={`Quantity for ${title}`}>
            <button
              type="button"
              onClick={() => onSetQuantity(line.id, line.quantity - 1)}
              disabled={decrementDisabled}
              aria-label="Decrease quantity"
              className={cn(
                'inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-l-xl text-foreground transition-colors duration-200 hover:bg-surface-muted',
                decrementDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
              )}
            >
              <Minus size={15} aria-hidden="true" />
            </button>
            <span aria-live="polite" aria-label={`Quantity: ${line.quantity}`} className="min-w-8 px-1 text-center text-sm font-semibold tabular-nums">
              {line.quantity}
            </span>
            <button
              type="button"
              onClick={() => onSetQuantity(line.id, line.quantity + 1)}
              disabled={pending}
              aria-label="Increase quantity"
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-r-xl text-foreground transition-colors duration-200 hover:bg-surface-muted disabled:cursor-wait disabled:opacity-60"
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
          <p className="text-base font-bold tabular-nums text-foreground">
            {formatINR(line.lineTotal)}
          </p>
        </div>
        )}
      </div>
    </li>
  );
}
