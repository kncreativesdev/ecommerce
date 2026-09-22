import { ProductCard } from './ProductCard.jsx';
import { cn } from '../../lib/cn.js';

/**
 * Responsive product grid (`2 / 3 / 4` columns) + layout-stable skeleton.
 * Skeletons mirror the card anatomy (image well + text blocks) in both
 * themes so loading never shifts layout.
 */
export function ProductGrid({ products = [], className }) {
  return (
    <ul className={cn('grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 xl:gap-6', className)}>
      {products.map((product) => (
        <li key={product.id} className="min-w-0">
          <ProductCard product={product} className="h-full" />
        </li>
      ))}
    </ul>
  );
}

function SkeletonCard() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="tp-shimmer aspect-square bg-surface-muted" />
      <div className="flex flex-col gap-2 p-4">
        <div className="tp-shimmer h-3 w-16 rounded bg-surface-muted" />
        <div className="tp-shimmer h-4 w-full rounded bg-surface-muted" />
        <div className="tp-shimmer h-4 w-2/3 rounded bg-surface-muted" />
        <div className="tp-shimmer h-5 w-24 rounded bg-surface-muted" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 8, className }) {
  return (
    <div
      role="status"
      aria-label="Loading products"
      className={cn('grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 xl:gap-6', className)}
    >
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}
