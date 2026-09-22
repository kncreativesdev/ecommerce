import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, PackagePlus, PackageSearch, Pencil, RotateCcw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTaxonomy } from '../hooks/useTaxonomy.js';
import { useProductStore } from '../stores/useProductStore.js';
import { activateProduct, deactivateProduct } from '../services/product.service.js';
import { findCategoryById } from '../utils/taxonomy.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { formatDate, formatINR } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * Product List (`/catalog/products`): real backend data only. Status filter
 * (All/Active/Inactive) via the admin-safe `?status=` filter, client-side
 * search + pagination over the scoped list (the API exposes no search
 * params — search filters first, then the page slices; page state stays
 * local and resets on search/scope edits). Columns show available fields —
 * name/slug, category, first-variant price, variant count, status badges,
 * creation date. No stock/rating/popularity columns: the API provides
 * none. Deactivate is a soft-deactivate (`DELETE` → `isActive=false`,
 * hidden from storefront reads); reactivate is `PATCH { isActive: true }`.
 */
const SCOPES = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];
const PAGE_SIZE = 12;

const PRODUCT_COLUMNS = [
  { key: 'product', label: 'Product' },
  { key: 'category', label: 'Category' },
  { key: 'price', label: 'Price' },
  { key: 'variants', label: 'Variants' },
  { key: 'status', label: 'Status' },
  { key: 'created', label: 'Created' },
  { key: 'actions', label: 'Actions', numeric: true },
];

export function ProductsPage() {
  const { categories } = useTaxonomy();
  const products = useProductStore((state) => state.products);
  const status = useProductStore((state) => state.status);
  const error = useProductStore((state) => state.error);
  const scope = useProductStore((state) => state.scope);
  const setScope = useProductStore((state) => state.setScope);
  const ensureProducts = useProductStore((state) => state.ensureProducts);
  const refreshProducts = useProductStore((state) => state.refreshProducts);
  const removeProduct = useProductStore((state) => state.removeProduct);
  const syncProduct = useProductStore((state) => state.syncProduct);

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  // Local page state (the list has no URL state by design — scope lives in
  // the store mirror; search and page stay component-local).
  const [page, setPage] = useState(1);
  const [deactivating, setDeactivating] = useState(null); // product | null
  const [mutating, setMutating] = useState(false);
  const [activatingId, setActivatingId] = useState(null);

  useEffect(() => {
    document.title = 'Products — Tech Pulse Admin';
    ensureProducts();
  }, [ensureProducts]);

  const isLoading = status === 'idle' || status === 'loading';

  const categoryNameFor = (product) => {
    if (product?.category?.name) return product.category.name;
    const match = product?.categoryId ? findCategoryById(categories, product.categoryId) : undefined;
    return match?.name ?? '—';
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryFilter && product?.categoryId !== categoryFilter) return false;
      if (!needle) return true;
      const fallback =
        product?.categoryId && categories
          ? categories.find((category) => category.id === product.categoryId)?.name
          : undefined;
      const haystacks = [product?.name, product?.slug, product?.brand, product?.category?.name, fallback];
      return haystacks.some(
        (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
      );
    });
  }, [products, query, categories, categoryFilter]);

  const priceFor = (product) => {
    const first = Array.isArray(product?.variants) ? product.variants[0] : undefined;
    return first ? formatINR(first.price) : '—';
  };

  // Client-side pagination AFTER search filtering (never before — filtering
  // first keeps later pages correct). Derived during render, so deactivate
  // (mirror removal) and search edits can never strand an invalid page:
  // out-of-range requests clamp to the final valid page.
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const paged = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleQueryChange = (value) => {
    setQuery(value);
    setPage(1);
  };

  const handleCategoryFilterChange = (value) => {
    setCategoryFilter(value);
    setPage(1);
  };

  const handleScopeChange = (value) => {
    setPage(1);
    setScope(value);
  };

  const clearFilters = () => {
    setQuery('');
    setCategoryFilter('');
    setPage(1);
  };

  const handleDeactivate = async () => {
    if (!deactivating?.id) return;
    setMutating(true);
    try {
      const record = await deactivateProduct(deactivating.id);
      removeProduct(deactivating.id, record);
      toast.success(`“${deactivating.name}” deactivated — hidden from the storefront.`);
      setDeactivating(null);
    } catch (deactivateError) {
      if (deactivateError?.status === 404 || deactivateError?.code === 'PRODUCT_NOT_FOUND') {
        removeProduct(deactivating.id);
        toast.success('Product already deactivated.');
        setDeactivating(null);
      } else {
        toast.error(deactivateError?.message ?? 'Deactivate failed. Please try again.');
      }
    } finally {
      setMutating(false);
    }
  };

  const handleActivate = async (product) => {
    if (!product?.id || activatingId) return;
    setActivatingId(product.id);
    try {
      const record = await activateProduct(product.id);
      syncProduct(record ?? { ...product, isActive: true });
      toast.success(`“${product.name}” reactivated — visible in the storefront.`);
    } catch (activateError) {
      toast.error(activateError?.message ?? 'Reactivation failed. Please try again.');
    } finally {
      setActivatingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Products"
        meta={isLoading ? 'Loading products…' : `${visible.length} of ${products.length} ${products.length === 1 ? 'product' : 'products'}`}
        actions={
          <Link
            to="/catalog/products/new"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 hover:no-underline"
          >
            <PackagePlus size={17} aria-hidden="true" />
            Add Product
          </Link>
        }
      />

      {!isLoading && !error && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div role="group" aria-label="Product status filter" className="inline-flex self-start rounded-lg border border-border bg-surface p-1">
            {SCOPES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleScopeChange(option.value)}
                aria-pressed={scope === option.value}
                disabled={isLoading}
                className={cn(
                  'inline-flex min-h-[36px] cursor-pointer items-center rounded-md px-3.5 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60',
                  scope === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {products.length > 0 ? (
            <div role="search" className="relative w-full sm:max-w-md">
              <label htmlFor="product-search" className="sr-only">
                Search products
              </label>
              <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="product-search"
                type="search"
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder="Search name, slug, brand, category…"
                autoComplete="off"
                className="min-h-[44px] w-full rounded-lg border border-input bg-surface pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 hover:border-border-strong"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => handleQueryChange('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="product-category-filter" className="sr-only">
              Filter by category
            </label>
            <select
              id="product-category-filter"
              value={categoryFilter}
              onChange={(event) => handleCategoryFilterChange(event.target.value)}
              className="min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {query || categoryFilter ? (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label="Loading products" className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load products" message={error.message} onRetry={refreshProducts} />
      ) : products.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={scope === 'inactive' ? 'No inactive products' : 'No products yet'}
          message={
            scope === 'inactive'
              ? 'Every product is currently active. Deactivated products will appear here for review and reactivation.'
              : 'Create the first product. It becomes purchasable once it has at least one active variant.'
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No products match"
          message={
            query.trim()
              ? `Nothing matches “${query.trim()}” under the current filters. Try a different keyword or clear the filters.`
              : 'Nothing matches the current filters. Adjust or clear them to see more products.'
          }
        />
      ) : (
        <>
        <Table caption="Product catalog" columns={PRODUCT_COLUMNS} minWidth="min-w-[840px]">
          {paged.map((product) => (
            <tr key={product.id} className="transition-colors hover:bg-surface-muted/50">
              <td className="px-4 py-3">
                <p className="font-semibold text-foreground">{product.name}</p>
                <p className="truncate text-xs text-muted-foreground">/{product.slug}</p>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{categoryNameFor(product)}</td>
              <td className="px-4 py-3 font-semibold tabular-nums text-foreground">{priceFor(product)}</td>
              <td className="px-4 py-3 tabular-nums text-muted-foreground">
                {Array.isArray(product.variants) ? product.variants.length : 0}
              </td>
              <td className="px-4 py-3">
                <span className="flex flex-wrap gap-1.5">
                  <Badge tone={product.isActive ? 'success' : 'neutral'}>
                    {product.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  {product.isFeatured ? <Badge tone="info">Featured</Badge> : null}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(product.createdAt)}</td>
              <td className="px-4 py-3 text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  <Link
                    to={`/catalog/products/${product.id}/edit`}
                    aria-label={`Edit ${product.name}`}
                    title={`Edit ${product.name}`}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground hover:no-underline"
                  >
                    <Pencil size={17} aria-hidden="true" />
                  </Link>
                  {product.isActive ? (
                    <button
                      type="button"
                      onClick={() => setDeactivating(product)}
                      aria-label={`Deactivate ${product.name}`}
                      title={`Deactivate ${product.name}`}
                      className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Ban size={17} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleActivate(product)}
                      disabled={activatingId === product.id}
                      aria-label={`Reactivate ${product.name}`}
                      title={`Reactivate ${product.name}`}
                      className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:cursor-wait disabled:opacity-60"
                    >
                      <RotateCcw size={17} aria-hidden="true" />
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </Table>
        <Pagination
          page={safePage}
          totalPages={pageCount}
          totalItems={visible.length}
          pageSize={PAGE_SIZE}
          itemLabel={visible.length === 1 ? 'product' : 'products'}
          onPageChange={setPage}
        />
        </>
      )}

      <div className="flex justify-start">
        <Button variant="secondary" onClick={refreshProducts} disabled={isLoading}>
          Refresh list
        </Button>
      </div>

      {deactivating ? (
        <Modal
          title={`Deactivate “${deactivating.name}”?`}
          onClose={() => !mutating && setDeactivating(null)}
          persistent={mutating}
        >
          <p className="text-sm leading-6 text-muted-foreground">
            This soft-deactivates the product: it disappears from the storefront and can no
            longer be purchased, but its record (variants, order history) is kept.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeactivating(null)} disabled={mutating}>
              Keep product
            </Button>
            <Button variant="destructive" loading={mutating} onClick={handleDeactivate}>
              Yes, deactivate
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
