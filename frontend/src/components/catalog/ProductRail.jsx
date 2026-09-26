import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ProductCard } from './ProductCard.jsx';
import { cn } from '../../lib/cn.js';

/**
 * Horizontal merchandising rail: left title (+ optional sub-copy), right
 * "view all" link, snap-scroll cards with edge peek on mobile and arrow
 * controls on desktop (Embla-free: native scroll + buttons; reduced-motion
 * safe by default). Reuses the single `ProductCard` implementation.
 */
export function ProductRail({ id, title, subtitle, viewAllTo, viewAllLabel = 'View all', products = [], className }) {
  const trackRef = useRef(null);

  const scrollByCards = (direction) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector('[data-rail-card]');
    const step = card ? card.getBoundingClientRect().width + 16 : 320;
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({ left: direction * step * 2, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  if (!Array.isArray(products) || products.length === 0) return null;

  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {viewAllTo ? (
            <Link
              to={viewAllTo}
              className="mr-1 hidden text-sm font-semibold text-accent-link hover:no-underline sm:inline"
            >
              {viewAllLabel}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => scrollByCards(-1)}
            aria-label={`Scroll ${title} left`}
            className="hidden h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border bg-surface-elevated text-foreground shadow-sm transition-colors duration-200 hover:bg-surface-muted md:inline-flex"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => scrollByCards(1)}
            aria-label={`Scroll ${title} right`}
            className="hidden h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border bg-surface-elevated text-foreground shadow-sm transition-colors duration-200 hover:bg-surface-muted md:inline-flex"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <ul
        ref={trackRef}
        data-testid="product-rail-track"
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 tp-no-scrollbar"
      >
        {products.map((product) => (
          <li
            key={product.id}
            data-rail-card
            className="w-[46%] shrink-0 snap-start sm:w-[31%] lg:w-[23.5%] xl:w-[18.8%]"
          >
            <ProductCard product={product} className="h-full" />
          </li>
        ))}
      </ul>
      {viewAllTo ? (
        <Link
          to={viewAllTo}
          className="self-center text-sm font-semibold text-accent-link hover:no-underline sm:hidden"
        >
          {viewAllLabel}
        </Link>
      ) : null}
    </section>
  );
}
