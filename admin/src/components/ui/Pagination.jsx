import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/**
 * Shared admin pagination — generic over any locally-paginated collection.
 * Pure client-side control: it knows nothing about products or the backend
 * (a future server `page`/`limit`/`total` contract can drive these same
 * props without redesigning callers).
 *
 * - `page`: 1-based current page (clamped internally, never out of bounds).
 * - `totalPages`, `totalItems`, `pageSize`: derived by the caller from the
 *   already-filtered/sorted collection.
 * - Renders nothing when there is a single page (no meaningless controls).
 * - Compact window (first · nearby · last with ellipsis) so dozens of pages
 *   never overflow narrow viewports. All targets ≥ 44px, keyboard-native.
 */
function pageWindow(page, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const near = new Set([1, totalPages, page - 1, page, page + 1]);
  const ordered = [...near].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);
  const windowed = [];
  ordered.forEach((value, index) => {
    if (index > 0 && value - ordered[index - 1] > 1) windowed.push('ellipsis');
    windowed.push(value);
  });
  return windowed;
}

const controlClass =
  'inline-flex h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-sm font-semibold text-foreground transition-colors duration-200 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50';

export function Pagination({
  page,
  totalPages,
  totalItems = 0,
  pageSize = 12,
  itemLabel = 'items',
  onPageChange,
  disabled = false,
  className,
}) {
  if (!Number.isInteger(totalPages) || totalPages <= 1) return null;
  const safePage = Math.min(Math.max(1, Number.isInteger(page) ? page : 1), totalPages);
  const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalItems);

  const go = (next) => {
    if (disabled || next < 1 || next > totalPages || next === safePage) return;
    onPageChange(next);
  };

  return (
    <nav aria-label="Pagination" className={cn('flex flex-col items-center gap-2', className)}>
      <p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
        Showing {start}–{end} of {totalItems} {itemLabel}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => go(safePage - 1)}
          disabled={disabled || safePage <= 1}
          aria-label="Go to previous page"
          className={controlClass}
        >
          <ChevronLeft size={17} aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </button>
        {pageWindow(safePage, totalPages).map((entry, index) =>
          entry === 'ellipsis' ? (
            <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-muted-foreground">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => go(entry)}
              disabled={disabled}
              aria-label={`Go to page ${entry}`}
              aria-current={entry === safePage ? 'page' : undefined}
              className={cn(
                controlClass,
                entry === safePage && 'border-primary bg-primary text-primary-foreground hover:bg-primary hover:opacity-90',
              )}
            >
              {entry}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => go(safePage + 1)}
          disabled={disabled || safePage >= totalPages}
          aria-label="Go to next page"
          className={controlClass}
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
