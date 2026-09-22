import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronRight, Minus, PackageSearch, Plus, ShoppingCart, Zap } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PriceBlock } from '../components/catalog/PriceBlock.jsx';
import { ProductCard } from '../components/catalog/ProductCard.jsx';
import { ProductGallery } from '../components/catalog/ProductGallery.jsx';
import { WishlistButton } from '../components/catalog/WishlistButton.jsx';
import { useProducts } from '../hooks/useProducts.js';
import { getActiveVariants, getDefaultVariant, getRelatedProducts } from '../utils/productAdapter.js';
import { useCartStore } from '../stores/useCartStore.js';
import { useAuthStore } from '../stores/useAuthStore.js';
import { fetchMyReviews } from '../services/reviews.service.js';
import { formatINR } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * Product detail (`/product/:id`, backend UUID): gallery, variant
 * selection, quantity stepper, Add to Cart / Buy Now (auth-gated with
 * redirect-back), wishlist toggle, trust assurances, description tabs,
 * related products. Availability is confirmed at checkout — no stock
 * quantities are displayed (no public inventory API).
 */
export function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    products,
    status: listStatus,
    error,
    ensureProduct,
    getProductById,
    refreshProducts,
  } = useProducts();
  const addItem = useCartStore((state) => state.addItem);
  const bulkPending = useCartStore((state) => state.bulkPending);

  const product = getProductById(id);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const isAuthenticated = useAuthStore((state) => Boolean(state.accessToken && state.user));
  // Authenticated user's own review for this product (`GET /reviews/me`
  // filtered client-side — no public listing endpoint exists). `undefined`
  // = unknown/loading, `null` = none or unavailable; failures stay silent
  // so the hint can never break the page.
  const [ownReview, setOwnReview] = useState(undefined);

  useEffect(() => {
    if (!isAuthenticated || !product) return;
    let cancelled = false;
    fetchMyReviews()
      .then((list) => {
        if (cancelled) return;
        setOwnReview(
          (Array.isArray(list) ? list : []).find((review) => review?.productId === product.id) ?? null,
        );
      })
      .catch(() => {
        if (!cancelled) setOwnReview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, product]);

  useEffect(() => {
    if (id && !product) {
      ensureProduct(id);
    }
  }, [id, product, ensureProduct]);

  useEffect(() => {
    document.title = product ? `${product.name} — Tech Pulse` : 'Product — Tech Pulse';
  }, [product]);

  const isNotFound = error?.code === 'NOT_FOUND' && !product;
  const isLoading = !product && !isNotFound && (listStatus === 'idle' || listStatus === 'loading');
  const isError = !product && !isNotFound && !isLoading;

  if (isLoading) {
    return (
      <Container className="py-10 sm:py-14">
        <div role="status" aria-label="Loading product" className="grid gap-8 lg:grid-cols-2">
          <div className="tp-shimmer aspect-[4/3] rounded-2xl bg-surface-muted" />
          <div className="flex flex-col gap-4">
            <div className="tp-shimmer h-4 w-28 rounded bg-surface-muted" />
            <div className="tp-shimmer h-8 w-3/4 rounded bg-surface-muted" />
            <div className="tp-shimmer h-7 w-40 rounded bg-surface-muted" />
            <div className="tp-shimmer h-20 w-full rounded bg-surface-muted" />
            <div className="tp-shimmer h-11 w-48 rounded-xl bg-surface-muted" />
          </div>
        </div>
      </Container>
    );
  }

  if (isNotFound) {
    return (
      <Container className="py-10 sm:py-14">
        <EmptyState
          icon={PackageSearch}
          title="Product not found"
          message="This product doesn’t exist or is no longer available."
          actionTo="/shop"
          actionLabel="Browse all products"
        />
      </Container>
    );
  }

  if (isError || !product) {
    return (
      <Container className="py-10 sm:py-14">
        <ErrorState
          title="Couldn’t load this product"
          message={error?.message ?? 'The product failed to load. Please retry.'}
          onRetry={() => (id ? ensureProduct(id) : refreshProducts())}
        />
      </Container>
    );
  }

  const variants = getActiveVariants(product);
  const selected = variants.find((variant) => variant.id === selectedVariantId) ?? getDefaultVariant(product);
  const related = getRelatedProducts(products, product, 4);

  const handleAdd = async ({ buyNow = false } = {}) => {
    if (!selected) {
      toast.error('This product has no purchasable variant right now.');
      return;
    }
    const result = await addItem({
      variantId: selected.id,
      quantity,
      snapshot: {
        productId: product.id,
        productName: product.name,
        productSlug: product.slug,
        variantName: selected.name,
        sku: selected.sku,
        unitPrice: selected.price,
      },
    });
    if (!result.ok) {
      if (result.error?.code === 'INSUFFICIENT_STOCK' || result.error?.status === 409) {
        toast.error('Not enough stock for that quantity right now.');
      } else if (result.error?.code === 'PRODUCT_VARIANT_INACTIVE' || result.error?.status === 422) {
        toast.error('This variant is no longer available.');
      } else {
        toast.error(result.error?.message ?? 'Could not add to cart.');
      }
      return;
    }
    if (buyNow) {
      navigate('/checkout');
    } else {
      toast.success(`${product.name} added to cart.`);
    }
  };

  return (
    <Container className="py-10 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-1 text-sm">
        <Link to="/" className="text-muted-foreground transition-colors hover:text-accent hover:no-underline">
          Home
        </Link>
        <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground" />
        <Link to="/shop" className="text-muted-foreground transition-colors hover:text-accent hover:no-underline">
          Shop
        </Link>
        {product.category ? (
          <>
            <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground" />
            <Link
              to={`/shop?category=${encodeURIComponent(product.category.slug)}`}
              className="text-muted-foreground transition-colors hover:text-accent hover:no-underline"
            >
              {product.category.name}
            </Link>
          </>
        ) : null}
        <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground" />
        <span aria-current="page" className="font-medium text-foreground">
          {product.name}
        </span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="relative">
          <ProductGallery productId={product.id} productName={product.name} variantId={selected?.id ?? null} />
          <WishlistButton
            productId={product.id}
            productName={product.name}
            productSlug={product.slug}
            productBrand={product.brand}
            className="absolute right-3 top-3"
          />
        </div>

        <div className="flex flex-col items-start gap-4">
          {product.brand ? (
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {product.brand}
            </p>
          ) : null}
          <h1 className="text-2xl font-bold tracking-tight">{product.name}</h1>
          {selected ? (
            <PriceBlock size="lg" price={selected.price} compareAtPrice={selected.compareAtPrice} />
          ) : (
            <p className="text-sm text-muted-foreground">Price unavailable</p>
          )}

          {variants.length > 1 ? (
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold text-foreground">
                Variant{selected ? `: ${selected.name}` : ''}
              </legend>
              <div className="flex flex-wrap gap-2">
                {variants.map((variant) => {
                  const isActive = variant.id === selected?.id;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => setSelectedVariantId(variant.id)}
                      aria-pressed={isActive}
                      className={cn(
                        'inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border px-4 text-sm font-medium transition-colors duration-200',
                        isActive
                          ? 'border-primary font-semibold text-primary'
                          : 'border-border text-secondary-foreground hover:bg-surface-muted',
                      )}
                    >
                      {variant.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {product.shortDescription ? (
            <p className="text-base leading-7 text-muted-foreground">{product.shortDescription}</p>
          ) : null}
          {selected?.sku ? (
            <p className="text-xs text-muted-foreground">
              SKU: <span className="font-medium text-foreground">{selected.sku}</span>
            </p>
          ) : null}

          <div className="flex w-full flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
            <div className="inline-flex items-center self-start rounded-xl border border-border" role="group" aria-label="Quantity">
              <button
                type="button"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                disabled={quantity <= 1}
                aria-label="Decrease quantity"
                className="inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-l-xl text-foreground transition-colors duration-200 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              <span aria-live="polite" aria-label={`Quantity: ${quantity}`} className="min-w-10 px-1 text-center text-base font-bold tabular-nums">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((value) => Math.min(99, value + 1))}
                aria-label="Increase quantity"
                className="inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-r-xl text-foreground transition-colors duration-200 hover:bg-surface-muted"
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleAdd()}
                disabled={bulkPending || !selected}
                aria-busy={bulkPending}
                className="inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-secondary-foreground transition-colors duration-200 hover:bg-surface-muted disabled:cursor-wait disabled:opacity-60"
              >
                <ShoppingCart size={17} aria-hidden="true" />
                Add to Cart
              </button>
              <button
                type="button"
                onClick={() => handleAdd({ buyNow: true })}
                disabled={bulkPending || !selected}
                aria-busy={bulkPending}
                className="inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground transition-colors duration-200 hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
              >
                <Zap size={17} aria-hidden="true" />
                Buy Now
              </button>
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Availability confirmed at checkout · Cash on Delivery ·{' '}
            {selected ? (
              <span className="font-semibold tabular-nums text-foreground">{formatINR(selected.price)}</span>
            ) : null}{' '}
            locked from live variant pricing.
          </p>
        </div>
      </div>

      {product.description ? (
        <section aria-label="Description" className="mt-10 max-w-3xl">
          <h2 className="mb-3 text-xl font-semibold tracking-tight">Description</h2>
          <p className="whitespace-pre-line text-sm leading-7 text-muted-foreground">
            {product.description}
          </p>
        </section>
      ) : null}

      {ownReview ? (
        <section aria-label="Your review" className="mt-8 max-w-3xl rounded-2xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold tracking-tight text-foreground">Your review</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            You rated this product {ownReview.rating}/5
            {ownReview.title ? (
              <>
                {' '}— <span className="font-medium text-foreground">“{ownReview.title}”</span>
              </>
            ) : null}
            .
          </p>
          <Link
            to="/account/reviews"
            className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-accent-link hover:no-underline"
          >
            View or edit in My reviews
          </Link>
        </section>
      ) : null}

      {/* Sticky mobile purchase bar (price + add), clear of toasts/floats. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-elevated/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">{selected?.name ?? product.name}</p>
            <p className="text-base font-extrabold tabular-nums text-foreground">
              {selected ? formatINR(selected.price) : '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleAdd()}
            disabled={bulkPending || !selected}
            className="inline-flex min-h-[48px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            <ShoppingCart size={17} aria-hidden="true" />
            Add to Cart
          </button>
        </div>
      </div>

      {related.length > 0 ? (
        <section aria-label="Related products" className="mt-12">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight">Related products</h2>
            {product.category ? (
              <Link
                to={`/shop?category=${encodeURIComponent(product.category.slug)}`}
                className="text-sm font-semibold text-accent-link hover:no-underline"
              >
                View all
              </Link>
            ) : null}
          </div>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 xl:gap-6">
            {related.map((item) => (
              <li key={item.id} className="min-w-0">
                <ProductCard product={item} className="h-full" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {/* Spacer so the fixed mobile bar never covers page content. */}
      <div aria-hidden="true" className="h-20 lg:hidden" />
    </Container>
  );
}
