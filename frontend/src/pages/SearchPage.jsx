import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PackageSearch, Search as SearchIcon, X } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { ProductGrid, ProductGridSkeleton } from '../components/catalog/ProductGrid.jsx';
import { useProducts } from '../hooks/useProducts.js';
import { useCatalogSearch } from '../hooks/useCatalogSearch.js';
import { useTaxonomy } from '../hooks/useTaxonomy.js';
import { selectFeaturedProducts } from '../utils/productAdapter.js';
import { categoryRouteParam } from '../utils/categoryAdapter.js';

/**
 * Search (`/search?q=...`, public): client-side text search over the
 * loaded catalog (no backend endpoint exists). Debounced input, result
 * count (`aria-live`), result grid, suggestions (categories + featured
 * products) for empty queries and no-hit states. Fetch-failure and
 * empty-catalog states stay distinct.
 */
export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const { products, status, error, isLoading, refreshProducts } = useProducts();
  const { query, setQuery, results, searched } = useCatalogSearch(initialQuery);
  const { taxonomy } = useTaxonomy();
  const featured = selectFeaturedProducts(products, 4);

  useEffect(() => {
    document.title = searched ? `Search: ${query} — Tech Pulse` : 'Search — Tech Pulse';
  }, [searched, query]);

  const submit = (event) => {
    event.preventDefault();
    const trimmed = query.trim();
    setSearchParams(trimmed ? { q: trimmed } : {});
  };

  return (
    <Container className="flex flex-col gap-6 py-10 sm:py-14">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Search products</h1>
        <form role="search" onSubmit={submit} className="flex items-center gap-2">
          <label htmlFor="search-input" className="sr-only">
            Search products
          </label>
          <div className="relative flex-1">
            <SearchIcon
              size={18}
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="search-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, brand, or keyword…"
              autoComplete="off"
              className="h-12 w-full rounded-full border border-input bg-surface pl-11 pr-11 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSearchParams({});
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <X size={17} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <button
            type="submit"
            className="inline-flex h-12 shrink-0 cursor-pointer items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90"
          >
            Search
          </button>
        </form>
      </div>

      {isLoading ? (
        <ProductGridSkeleton count={8} />
      ) : status === 'error' ? (
        <ErrorState
          title="Search is unavailable"
          message={error?.message ?? 'The catalog failed to load.'}
          onRetry={refreshProducts}
        />
      ) : products.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Catalog coming soon"
          message="No products are listed right now. Please check back later."
          actionTo="/"
          actionLabel="Back to home"
        />
      ) : !searched ? (
        <SearchSuggestions taxonomy={taxonomy ?? []} featured={featured} />
      ) : results.length === 0 ? (
        <div className="flex flex-col gap-6">
          <EmptyState
            icon={PackageSearch}
            title={`No results for “${query.trim()}”`}
            message="Try a different keyword, or browse a category below."
          />
          <SearchSuggestions taxonomy={taxonomy ?? []} featured={featured} />
        </div>
      ) : (
        <>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {results.length} {results.length === 1 ? 'result' : 'results'} for “{query.trim()}”
          </p>
          <ProductGrid products={results} />
        </>
      )}
    </Container>
  );
}

function SearchSuggestions({ taxonomy, featured }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {taxonomy.length > 0 ? (
        <section aria-label="Browse categories">
          <h2 className="mb-3 text-base font-bold text-foreground">Browse categories</h2>
          <ul className="flex flex-wrap gap-2">
            {taxonomy.slice(0, 8).map((category) => (
              <li key={category.slug ?? category.id}>
                <Link
                  to={`/category/${categoryRouteParam(category)}`}
                  className="inline-flex min-h-[40px] items-center rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors duration-200 hover:border-accent hover:text-accent hover:no-underline"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {featured.length > 0 ? (
        <section aria-label="Featured products">
          <h2 className="mb-3 text-base font-bold text-foreground">Featured right now</h2>
          <ul className="flex flex-wrap gap-2">
            {featured.map((product) => (
              <li key={product.id}>
                <Link
                  to={`/product/${product.id}`}
                  className="inline-flex min-h-[40px] items-center rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors duration-200 hover:border-accent hover:text-accent hover:no-underline"
                >
                  {product.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
