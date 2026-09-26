import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { PriceBlock } from './PriceBlock.jsx';
import { ProductImage } from './ProductImage.jsx';
import { WishlistButton } from './WishlistButton.jsx';
import { getBestDiscountPercent, getDefaultVariant, getVariantStockState } from '../../utils/productAdapter.js';
import { useCartStore } from '../../stores/useCartStore.js';
import { cn } from '../../lib/cn.js';

/**
 * Single product card implementation for every grid/rail (Home, Shop,
 * Category, Search, Wishlist). Presentational + two store-backed actions:
 * wishlist heart (always visible) and quick add-to-cart. Guests mutate a
 * persisted local cart that merges on login; authenticated users hit the
 * server directly. Anatomy per DESIGN_SYSTEM.md §7; discount badges derive
 * ONLY from real backend pricing. No ratings, reviews, stock, or
 * popularity — the backend exposes none.
 *
 * Card image rule (deterministic — see `getDefaultVariantImage` in
 * `utils/variantMedia.js`): the first active variant's primary image,
 * else its first ordered image, else the legacy product-level primary /
 * first image, else the placeholder. Achieved here via `getDefaultVariant`
 * + `ProductImage`'s variant-scoped `displayImageForVariant` pick (same
 * priority) — never random, never a non-default variant's image.
 */
export function ProductCard({ product, showWishlist = true, showAdd = true, className }) {
  const addItem = useCartStore((state) => state.addItem);
  const bulkPending = useCartStore((state) => state.bulkPending);

  if (!product) return null;
  const variant = getDefaultVariant(product);
  const discount = getBestDiscountPercent(product);
  // Variant-specific availability from backend inventory truth. Cards use
  // the default purchasable variant (the unit quick-add buys).
  const stockState = getVariantStockState(variant);

  const handleAdd = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!variant) {
      toast.error('This product has no purchasable variant right now.');
      return;
    }
    // UX protection only — the backend still enforces inventory (409).
    if (stockState === false) {
      toast.error('This product is out of stock.');
      return;
    }
    const result = await addItem({
      variantId: variant.id,
      quantity: 1,
      snapshot: {
        productId: product.id,
        productName: product.name,
        productSlug: product.slug,
        variantName: variant.name,
        sku: variant.sku,
        unitPrice: variant.price,
      },
    });
    if (result.ok) {
      toast.success(`${product.name} added to cart.`);
    } else if (result.error?.code === 'INSUFFICIENT_STOCK' || result.error?.status === 409) {
      // Stale frontend state: the UI said in-stock but the backend rejects
      // (stock became unavailable) — surface as an out-of-stock toast.
      toast.error('This product is out of stock right now.');
    } else if (result.error?.code === 'PRODUCT_VARIANT_INACTIVE' || result.error?.status === 422) {
      toast.error('This variant is no longer available.');
    } else {
      toast.error(result.error?.message ?? 'Could not add to cart. Please try again.');
    }
  };

  return (
    <article
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg',
        className,
      )}
    >
      <div className="relative">
        <Link
          to={`/product/${product.id}`}
          aria-label={product.name}
          className="relative block aspect-square hover:no-underline"
        >
          <ProductImage productId={product.id} variantId={variant?.id ?? null} alt={product.name} />
        </Link>
        {discount !== null ? (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-accent-foreground">
            {discount}% off
          </span>
        ) : null}
        {showWishlist ? (
          <WishlistButton
            productId={product.id}
            productName={product.name}
            productSlug={product.slug}
            productBrand={product.brand}
            className="absolute right-2.5 top-2.5"
          />
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {/* Brand slot always reserves one line so brandless products never
            shift the title/price/button rhythm of neighboring cards. */}
        <p className="min-h-[17px] text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {product.brand ?? ''}
        </p>
        <h3 className="line-clamp-2 min-h-[36px] text-[13px] font-medium leading-[18px]">
          <Link
            to={`/product/${product.id}`}
            className="text-card-foreground transition-colors duration-200 hover:text-accent hover:no-underline"
          >
            {product.name}
          </Link>
        </h3>
        {/* Price slot reserves the wrapped MRP+badge row so discount badges
            never push the Add button out of alignment across cards. */}
        <div className="flex min-h-[52px] flex-col justify-center">
          {variant ? (
            <PriceBlock price={variant.price} compareAtPrice={variant.compareAtPrice} />
          ) : (
            <p className="text-sm text-muted-foreground">Price unavailable</p>
          )}
        </div>
        {stockState !== null ? (
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
        {showAdd ? (
          <button
            type="button"
            onClick={handleAdd}
            disabled={bulkPending || !variant}
            aria-label={`Add ${product.name} to cart`}
            className="mt-auto inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-wait disabled:opacity-60 sm:min-h-[40px]"
          >
            <ShoppingCart size={16} aria-hidden="true" />
            Add
          </button>
        ) : null}
      </div>
    </article>
  );
}
