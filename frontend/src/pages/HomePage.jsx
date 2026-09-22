import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, Headset, ShieldCheck } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { CategoryTile } from '../components/catalog/CategoryTile.jsx';
import { ProductRail } from '../components/catalog/ProductRail.jsx';
import { ProductGridSkeleton } from '../components/catalog/ProductGrid.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { HeroCarousel } from '../components/home/HeroCarousel.jsx';
import { useTaxonomy } from '../hooks/useTaxonomy.js';
import { useProducts } from '../hooks/useProducts.js';
import {
  selectFeaturedProducts,
  selectMaxDiscountedProducts,
  selectNewArrivals,
} from '../utils/productAdapter.js';
import { categoryRouteParam } from '../utils/categoryAdapter.js';

/**
 * Home (`/`, public): watch hero carousel, icon category discovery,
 * Featured / New Arrivals / Maximum Discounted rails, promo band, trust
 * strip. All merchandising derives client-side from the loaded catalog
 * cache (no popularity/newest/discount endpoints exist):
 * - Hero ← real watch-product media (variable 1–3 slides, see
 *   `HeroCarousel`), falling back to a static intro with no fake imagery,
 * - Featured rail ← `isFeatured` (honestly labeled, never "Most Popular"),
 * - New Arrivals ← `createdAt` desc, Maximum Discounted ← best variant `%`.
 * Rails collapse gracefully when empty; a catalog failure shows one local
 * error card with retry and never breaks the page chrome.
 */
export function HomePage() {
  const { taxonomy, status: taxonomyStatus, error: taxonomyError, refreshTaxonomy } = useTaxonomy();
  const { products, status: productStatus, error: productError, refreshProducts } = useProducts();
  const taxonomyFailed = taxonomyStatus === 'error';

  useEffect(() => {
    document.title = 'Tech Pulse — Premium Electronics Store';
  }, []);

  const catalogLoading = productStatus === 'idle' || productStatus === 'loading';
  const catalogFailed = productStatus === 'error';
  const featured = selectFeaturedProducts(products, 10);
  const newArrivals = selectNewArrivals(products, 10);
  const maxDiscounted = selectMaxDiscountedProducts(products, 10);
  const topCategories = (taxonomy ?? []).slice(0, 8);

  return (
    <div className="flex flex-col">
      <HeroCarousel products={products} isLoading={catalogLoading} />

      <Container className="flex flex-col gap-10 py-10 sm:gap-14 sm:py-14">
        <section aria-labelledby="home-categories">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 id="home-categories" className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Shop by category
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Everyday gadget essentials, honestly priced.</p>
            </div>
            <Link to="/shop" className="hidden shrink-0 text-sm font-semibold text-accent-link hover:no-underline sm:inline">
              View all
            </Link>
          </div>
          {topCategories.length > 0 ? (
            <ul className="grid grid-cols-4 gap-3 sm:gap-4 lg:grid-cols-8">
              {topCategories.map((category) => (
                <li key={category.slug ?? category.id} className="min-w-0">
                  <CategoryTile category={category} to={`/category/${categoryRouteParam(category)}`} />
                </li>
              ))}
            </ul>
          ) : taxonomyStatus === 'idle' || taxonomyStatus === 'loading' ? (
            <div className="grid grid-cols-4 gap-3 sm:gap-4 lg:grid-cols-8" role="status" aria-label="Loading categories">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="aspect-square rounded-2xl" />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              Categories are on their way — browse the full catalog meanwhile.{' '}
              <Link to="/shop" className="font-semibold text-accent-link hover:no-underline">Shop all</Link>
            </p>
          )}
          {taxonomyFailed && topCategories.length > 0 ? (
            <p className="mt-3 flex flex-wrap items-center justify-center gap-2 text-center text-xs text-muted-foreground">
              <span>Live categories couldn’t be refreshed{taxonomyError?.message ? ` (${taxonomyError.message})` : ''} — showing the built-in list.</span>
              <button
                type="button"
                onClick={refreshTaxonomy}
                className="cursor-pointer font-semibold text-accent-link hover:no-underline"
              >
                Retry
              </button>
            </p>
          ) : null}
        </section>

        {catalogLoading ? (
          <div role="status" aria-label="Loading products">
            <Skeleton className="mb-4 h-7 w-56" />
            <ProductGridSkeleton count={4} className="md:grid-cols-4 xl:grid-cols-4" />
          </div>
        ) : catalogFailed ? (
          <ErrorState
            title="Couldn’t load today’s picks"
            message={productError?.message ?? 'The catalog failed to load. Your cart and navigation still work.'}
            onRetry={refreshProducts}
          />
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-sm">
            <h2 className="max-w-xl text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Catalog coming soon.
            </h2>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              No products are available right now. Categories and navigation still work — check back shortly or talk to support.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={refreshProducts}
                className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90"
              >
                Retry
              </button>
              <Link
                to="/support"
                className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-surface px-6 py-3 text-sm font-semibold text-secondary-foreground transition-colors duration-200 hover:bg-surface-muted hover:no-underline"
              >
                Talk to support
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ProductRail
              id="home-featured"
              title="Featured Products"
              subtitle="Handpicked by Tech Pulse — worth a closer look."
              viewAllTo="/shop"
              products={featured}
            />
            <ProductRail
              id="home-new"
              title="New Arrivals"
              subtitle="The latest additions to the catalog."
              viewAllTo="/shop?sort=newest"
              products={newArrivals}
            />
            <ProductRail
              id="home-deals"
              title="Maximum Discounted"
              subtitle="Biggest genuine price drops, computed from MRP."
              viewAllTo="/shop"
              products={maxDiscounted}
            />
          </>
        )}

        <PromoBand />
        <TrustStrip />

        <section aria-label="Continue shopping" className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-sm">
          <h2 className="max-w-xl text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Power up your everyday carry.
          </h2>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            Audio, charging, and desk essentials with clear INR pricing and Cash on Delivery.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              to="/shop"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 hover:no-underline"
            >
              Shop all products
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link
              to="/support"
              className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-surface px-6 py-3 text-sm font-semibold text-secondary-foreground transition-colors duration-200 hover:bg-surface-muted hover:no-underline"
            >
              Talk to support
            </Link>
          </div>
        </section>
      </Container>
    </div>
  );
}

function PromoBand() {
  return (
    <section
      aria-label="Tech Pulse promise"
      className="overflow-hidden rounded-2xl border border-header-border bg-header px-6 py-10 text-center text-header-foreground sm:px-10"
    >
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-link">The Tech Pulse promise</p>
      <h2 className="mx-auto mt-2 max-w-2xl text-xl font-bold tracking-tight sm:text-2xl">
        Pay cash at your door. Love it or reach out — a human replies.
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-header-muted">
        Every order is Cash on Delivery with an immutable snapshot receipt, and every
        price shows its MRP next to it. That’s the whole business model.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link
          to="/shop?sort=newest"
          className="inline-flex min-h-[44px] items-center rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition-colors duration-200 hover:bg-accent-hover hover:no-underline"
        >
          See what’s new
        </Link>
        <Link
          to="/about"
          className="inline-flex min-h-[44px] items-center rounded-xl border border-header-border px-6 py-3 text-sm font-semibold text-header-foreground transition-colors duration-200 hover:bg-header-foreground/10 hover:no-underline"
        >
          Our story
        </Link>
      </div>
    </section>
  );
}

function TrustStrip() {
  const items = [
    { icon: Banknote, title: 'Cash on Delivery', text: 'Pay at your doorstep, every order.' },
    { icon: ShieldCheck, title: 'Genuine products', text: 'Sourced and quality-checked.' },
    { icon: Headset, title: 'Support that replies', text: 'Help with orders and products.' },
  ];
  return (
    <section aria-label="Why shop with Tech Pulse" className="grid gap-3 sm:grid-cols-3 sm:gap-4">
      {items.map((item) => (
        <div key={item.title} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <span aria-hidden="true" className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-accent">
            <item.icon size={24} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground">{item.title}</h3>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{item.text}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
