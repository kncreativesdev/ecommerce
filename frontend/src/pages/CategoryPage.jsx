import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PackageSearch } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { CategoryImage } from '../components/catalog/CategoryImage.jsx';
import { SubcategoryThumb } from '../components/layout/header/SubcategoryThumb.jsx';
import { ProductGrid, ProductGridSkeleton } from '../components/catalog/ProductGrid.jsx';
import { useTaxonomy } from '../hooks/useTaxonomy.js';
import { useProducts } from '../hooks/useProducts.js';
import { filterProductsByCategory } from '../utils/productAdapter.js';
import { categoryRouteParam } from '../utils/categoryAdapter.js';

/**
 * Category (`/category/:id`, backend UUID once ids resolve): header
 * (name/description), sub-category chips from the `parentId` hierarchy,
 * product grid for that `categoryId`, related categories. `404`-equivalent
 * (unknown id/slug) renders the not-found empty state.
 */
export function CategoryPage() {
  const { id } = useParams();
  const { taxonomy } = useTaxonomy();
  const { products, status, error, isLoading, refreshProducts } = useProducts();

  const category =
    (taxonomy ?? []).find((entry) => entry.id === id || entry.slug === id) ?? null;
  // Sub-category chips come from the normalized record (`parentId`
  // hierarchy when backend-driven, documented fallback otherwise).
  const subcategories = category?.subcategories ?? [];
  const related = (taxonomy ?? []).filter((entry) => entry.slug !== category?.slug).slice(0, 6);

  const visible = category ? filterProductsByCategory(products, category) : [];

  useEffect(() => {
    document.title = category ? `${category.name} — Tech Pulse` : 'Category — Tech Pulse';
  }, [category]);

  return (
    <Container className="flex flex-col gap-6 py-10 sm:py-14">
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/' },
          { label: 'Shop', to: '/shop' },
          { label: category?.name ?? 'Category' },
        ]}
      />

      {!category && (taxonomy ?? []).length > 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Category not found"
          message="This category doesn’t exist or is no longer available."
          actionTo="/shop"
          actionLabel="Browse all products"
        />
      ) : (
        <>
          <div className="flex items-start gap-4">
            <CategoryImage
              image={category?.image}
              name={category?.name}
              icon={category?.icon}
              eager
              className="h-16 w-16 rounded-2xl sm:h-20 sm:w-20 [&_svg]:size-7"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {category?.name ?? 'Category'}
              </h1>
              {category?.description ? (
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{category.description}</p>
              ) : null}
            </div>
          </div>
          {subcategories.length > 0 ? (
            <ul aria-label="Subcategories" className="mt-2 flex flex-wrap gap-2">
              {subcategories.map((sub) => (
                <li key={sub.slug ?? sub.id}>
                  <Link
                    to={`/shop?category=${encodeURIComponent(category.slug)}&subcategory=${encodeURIComponent(sub.slug)}`}
                    className="group inline-flex min-h-[40px] items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-4 text-sm font-medium text-foreground transition-colors duration-200 hover:border-accent hover:text-accent hover:no-underline"
                  >
                    <SubcategoryThumb subcategory={sub} size="sm" className="rounded-full" />
                    {sub.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          {isLoading ? (
            <ProductGridSkeleton count={8} />
          ) : status === 'error' ? (
            <ErrorState
              title="Couldn’t load this category"
              message={error?.message ?? 'The catalog failed to load.'}
              onRetry={refreshProducts}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title="No products in this category yet"
              message="Try the full catalog or another category."
              actionTo="/shop"
              actionLabel="Browse all products"
            />
          ) : (
            <>
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {visible.length} {visible.length === 1 ? 'product' : 'products'}
              </p>
              <ProductGrid products={visible} />
            </>
          )}

          {related.length > 0 ? (
            <section aria-label="Related categories" className="mt-2">
              <h2 className="mb-3 text-base font-bold text-foreground">Related categories</h2>
              <ul className="flex flex-wrap gap-2">
                {related.map((entry) => (
                  <li key={entry.slug ?? entry.id}>
                    <Link
                      to={`/category/${categoryRouteParam(entry)}`}
                      className="inline-flex min-h-[40px] items-center rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors duration-200 hover:border-accent hover:text-accent hover:no-underline"
                    >
                      {entry.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </Container>
  );
}
