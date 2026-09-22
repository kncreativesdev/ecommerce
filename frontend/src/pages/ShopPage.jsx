import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, Info, PackageSearch, SlidersHorizontal } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { ProductGrid, ProductGridSkeleton } from '../components/catalog/ProductGrid.jsx';
import { ShopFilters } from '../components/catalog/ShopFilters.jsx';
import { useTaxonomy } from '../hooks/useTaxonomy.js';
import { useProducts } from '../hooks/useProducts.js';
import { cn } from '../lib/cn.js';
import {
  filterFeaturedOnly,
  filterProductsByBrand,
  filterProductsByCategory,
  filterProductsByMinDiscount,
  filterProductsByPriceRange,
  getAvailableBrands,
  getMaxDiscountPercent,
  getPriceBounds,
  paginateProducts,
  sortProducts,
} from '../utils/productAdapter.js';
import { findCategory } from '../utils/categoryAdapter.js';

/**
 * Shop: browse the catalog with URL-driven selection.
 *
 * Data flow: URL state → taxonomy store (category resolution) + product
 * store (full-catalog cache) → client-side filter/sort/paginate →
 * ProductGrid. Client-side derivation is the documented architecture: the
 * backend exposes only `GET /products` with no query params (GAP-04), so
 * the catalog is fetched once and every control below derives from cache.
 * Filters live in the URL (`useSearchParams`) — shareable, bookmarkable,
 * and preserved across refresh and back/forward navigation.
 *
 * Honesty rules enforced here:
 * - `category` resolves via the normalized taxonomy store (slug → backend
 *   id when available, slug match otherwise). Unknown slugs → not-found
 *   empty state, never a crash.
 * - `subcategory` has NO backend support (no product subcategory field):
 *   the page filters to the parent category, displays the selected
 *   subcategory state, and states the limitation plainly.
 * - `sort=newest` (the documented New Arrivals convention) sorts the
 *   loaded dataset by `createdAt` desc. Unknown sort values fall back to
 *   catalog order.
 * - `brand`/`minPrice`/`maxPrice`/`discount`/`featured` filter the loaded
 *   dataset only; invalid values are ignored, never crash.
 */

const PAGE_SIZE = 12;
const DISCOUNT_THRESHOLDS = [10, 20, 30, 40, 50];

function parsePriceParam(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseDiscountParam(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parsePageParam(value) {
  if (typeof value !== 'string' || value.trim() === '') return 1;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

export function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { taxonomy } = useTaxonomy();
  const { products, status, error, refreshProducts } = useProducts();

  const categorySlug = searchParams.get('category');
  const subcategorySlug = searchParams.get('subcategory');
  const brand = searchParams.get('brand');
  const minPriceRaw = searchParams.get('minPrice');
  const maxPriceRaw = searchParams.get('maxPrice');
  const discountRaw = searchParams.get('discount');
  const featured = searchParams.get('featured') === 'true';
  const sort = searchParams.get('sort');
  const requestedPage = parsePageParam(searchParams.get('page'));

  const category = categorySlug ? findCategory(taxonomy, categorySlug) : null;
  const subcategory = subcategorySlug && category
    ? category.subcategories.find((sub) => sub.slug === subcategorySlug) ?? null
    : null;

  const title = subcategory?.name ?? category?.name ?? 'Shop';

  useEffect(() => {
    document.title = `${title} — Tech Pulse`;
  }, [title]);

  // Filter options derive from the FULL catalog so they stay stable while
  // other filters change (never from the filtered subset).
  const brands = getAvailableBrands(products);
  const priceBounds = getPriceBounds(products);
  const maxDiscount = getMaxDiscountPercent(products);
  const discountOptions = DISCOUNT_THRESHOLDS.filter(
    (threshold) => maxDiscount !== null && threshold <= maxDiscount,
  );

  // Parse + normalize price bounds (invalid values ignored; inverted range
  // forgiven by swapping rather than yielding zero results).
  let minPrice = parsePriceParam(minPriceRaw);
  let maxPrice = parsePriceParam(maxPriceRaw);
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  const discount = parseDiscountParam(discountRaw);

  let visible = [...products];
  if (category) visible = filterProductsByCategory(visible, category);
  if (brand) visible = filterProductsByBrand(visible, brand);
  visible = filterProductsByPriceRange(visible, minPrice, maxPrice);
  if (discount !== null) visible = filterProductsByMinDiscount(visible, discount);
  if (featured) visible = filterFeaturedOnly(visible);
  visible = sortProducts(visible, sort);

  // Client-side pagination over the filtered/sorted array. Out-of-range
  // pages clamp to the last valid page instead of crashing.
  const { items: paged, page: safePage, pageCount } = paginateProducts(
    visible,
    requestedPage,
    PAGE_SIZE,
  );

  const activeFilterCount = [
    categorySlug,
    subcategorySlug,
    brand,
    minPriceRaw,
    maxPriceRaw,
    discountRaw,
    searchParams.get('featured'),
    sort,
  ].filter((value) => typeof value === 'string' && value !== '').length;
  const hasActiveFilters = activeFilterCount > 0;

  const gridTopRef = useRef(null);

  // Mobile filter disclosure (desktop shows the panel unconditionally via
  // `lg:block`; one DOM instance, no duplicated controls).
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Update one facet while preserving every other URL param. Any
  // filter/sort change resets to page 1; page navigation preserves filters.
  const updateParams = (mutate, { resetPage = true } = {}) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    if (resetPage) next.delete('page');
    setSearchParams(next, { preventScrollReset: true });
  };

  const setParamOrDelete = (next, key, value) => {
    if (typeof value === 'string' && value.trim() !== '') {
      next.set(key, value.trim());
    } else {
      next.delete(key);
    }
  };

  const goToPage = (nextPage) => {
    updateParams((next) => {
      next.set('page', String(nextPage));
    }, { resetPage: false });
    gridTopRef.current?.scrollIntoView({ block: 'start' });
  };

  const isLoading = status === 'idle' || status === 'loading';
  const unknownCategory = Boolean(categorySlug) && !category;
  const unknownSubcategory = Boolean(subcategorySlug) && category && !subcategory;
  const showFilters = !isLoading && status === 'success' && !unknownCategory && !unknownSubcategory;

  return (
    <Container className="py-10 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        <Link to="/" className="text-muted-foreground transition-colors hover:text-accent hover:no-underline">
          Home
        </Link>
        <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground" />
        {category ? (
          <>
            <Link
              to="/shop"
              className="text-muted-foreground transition-colors hover:text-accent hover:no-underline"
            >
              Shop
            </Link>
            <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground" />
            <span aria-current="page" className="font-medium text-foreground">
              {title}
            </span>
          </>
        ) : (
          <span aria-current="page" className="font-medium text-foreground">
            Shop
          </span>
        )}
      </nav>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {!isLoading && status === 'success' ? (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {visible.length} {visible.length === 1 ? 'product' : 'products'}
            {pageCount > 1 ? ` · Page ${safePage} of ${pageCount}` : ''}
          </p>
        ) : null}
      </div>

      {subcategory ? (
        <p className="mb-6 flex items-start gap-2 rounded-xl border border-border bg-surface-muted px-4 py-3 text-[13px] leading-5 text-muted-foreground">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            Showing {category.name} products for “{subcategory.name}”. Per-subcategory
            filtering arrives with backend product–subcategory support; the
            catalog below covers the whole {category.name} category.
          </span>
        </p>
      ) : null}

      {showFilters ? (
        <>
          <div className="mb-3 lg:hidden">
            <Button
              variant="secondary"
              aria-expanded={filtersOpen}
              aria-controls="shop-filters"
              onClick={() => setFiltersOpen((value) => !value)}
              className="w-full"
            >
              <SlidersHorizontal size={17} aria-hidden="true" />
              {hasActiveFilters ? `Filters · ${activeFilterCount} active` : 'Filters & sorting'}
            </Button>
          </div>
          {/* Mobile filter collapse: CSS grid-rows animation (no unmount, no
              fixed max-height); `invisible` removes collapsed controls from
              keyboard focus, `lg:visible` keeps desktop always reachable. */}
          <div
            id="shop-filters"
            className={cn(
              'mb-6 grid transition-[grid-template-rows,visibility] duration-200 ease-out lg:grid-rows-[1fr] lg:visible',
              filtersOpen ? 'grid-rows-[1fr] visible' : 'grid-rows-[0fr] invisible',
            )}
          >
            <div className="min-h-0 overflow-hidden lg:overflow-visible">
              <ShopFilters
                taxonomy={taxonomy}
                categorySlug={categorySlug}
                brands={brands}
                brand={brand}
                priceBounds={priceBounds}
                minPrice={minPriceRaw}
                maxPrice={maxPriceRaw}
                discountOptions={discountOptions}
                discount={discount}
                featured={featured}
                sort={sort}
                onCategoryChange={(value) => updateParams((next) => {
                  setParamOrDelete(next, 'category', value);
                  next.delete('subcategory');
                })}
                onBrandChange={(value) => updateParams((next) => {
                  setParamOrDelete(next, 'brand', value);
                })}
                onMinPriceChange={(value) => updateParams((next) => {
                  setParamOrDelete(next, 'minPrice', value);
                })}
                onMaxPriceChange={(value) => updateParams((next) => {
                  setParamOrDelete(next, 'maxPrice', value);
                })}
                onDiscountChange={(value) => updateParams((next) => {
                  setParamOrDelete(next, 'discount', value);
                })}
                onFeaturedChange={(checked) => updateParams((next) => {
                  if (checked) next.set('featured', 'true');
                  else next.delete('featured');
                })}
                onSortChange={(value) => updateParams((next) => {
                  setParamOrDelete(next, 'sort', value);
                })}
              />
              {hasActiveFilters ? (
                <div className="mt-3 flex justify-end">
                  <Link
                    to="/shop"
                    className="inline-flex min-h-[44px] items-center text-sm font-semibold text-accent-link hover:no-underline"
                  >
                    Clear all filters
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {isLoading ? (
        <ProductGridSkeleton count={8} />
      ) : status === 'error' ? (
        <ErrorState
          title="Couldn’t load the catalog"
          message={error?.message ?? 'The product list failed to load. Your navigation still works — please retry.'}
          onRetry={refreshProducts}
        />
      ) : unknownCategory ? (
        <EmptyState
          icon={PackageSearch}
          title="Category not found"
          message={`“${categorySlug}” doesn’t match a known category. Browse the full catalog instead.`}
          actionTo="/shop"
          actionLabel="Browse all products"
        />
      ) : unknownSubcategory ? (
        <EmptyState
          icon={PackageSearch}
          title="Subcategory not found"
          message={`“${subcategorySlug}” isn’t part of ${category.name}. View the whole category instead.`}
          actionTo={`/shop?category=${encodeURIComponent(category.slug)}`}
          actionLabel={`View all ${category.name}`}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No products found"
          message={
            hasActiveFilters
              ? 'Nothing matches the current filters. Try widening the price range or clearing filters.'
              : category
                ? `Nothing is listed under ${title} right now. Try the full catalog.`
                : 'The catalog is empty right now. Check back soon.'
          }
          actionTo="/shop"
          actionLabel="Clear filters"
        />
      ) : (
        <div ref={gridTopRef} className="scroll-mt-24">
          <ProductGrid products={paged} />
          {pageCount > 1 ? (
            <nav aria-label="Catalog pages" className="mt-6 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage <= 1}
                className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-border px-4 text-sm font-semibold transition-colors duration-200 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <p aria-live="polite" className="min-w-24 px-2 text-center text-sm tabular-nums text-muted-foreground">
                Page {safePage} of {pageCount}
              </p>
              <button
                type="button"
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage >= pageCount}
                className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-border px-4 text-sm font-semibold transition-colors duration-200 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </nav>
          ) : null}
        </div>
      )}
    </Container>
  );
}
