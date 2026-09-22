import { useEffect } from 'react';
import { toast } from 'sonner';
import { Heart } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { ProductCard } from '../components/catalog/ProductCard.jsx';
import { ProductGridSkeleton } from '../components/catalog/ProductGrid.jsx';
import { useWishlistStore } from '../stores/useWishlistStore.js';
import { useProductStore } from '../stores/useProductStore.js';
import { useProducts } from '../hooks/useProducts.js';
import { useCartStore } from '../stores/useCartStore.js';
import { getDefaultVariant } from '../utils/productAdapter.js';

/**
 * Wishlist (`/wishlist`, protected): saved products (product-level).
 * Cards render from wishlist briefs merged with catalog rows when loaded;
 * move-to-cart adds the default/first active variant, then asks whether to
 * remove the wishlist line. Re-add `409`s are absorbed as "saved".
 */
export function WishlistPage() {
  const wishlist = useWishlistStore((state) => state.wishlist);
  const status = useWishlistStore((state) => state.status);
  const error = useWishlistStore((state) => state.error);
  const bootstrap = useWishlistStore((state) => state.bootstrap);
  const removeByItemId = useWishlistStore((state) => state.removeByItemId);
  const dropGuestEntries = useWishlistStore((state) => state.dropGuestEntries);
  const isGuest = useWishlistStore((state) => !state.sessionActive);
  const { products, getProductById, ensureProduct } = useProducts();
  const addItem = useCartStore((state) => state.addItem);

  useEffect(() => {
    document.title = 'Wishlist — Tech Pulse';
    bootstrap();
  }, [bootstrap]);

  const isLoading = status === 'idle' || status === 'loading';

  const resolveProduct = (item) => {
    const full = getProductById(item.productId);
    if (full) return full;
    const brief = item.product;
    if (!brief) return null;
    // Wishlist briefs carry no prices/images — merge enriches when the
    // catalog row arrives; until then the card shows the brief's default
    // variant (id/name/sku/price from the server brief) instead of
    // name-only info.
    const briefVariants = Array.isArray(brief.variants) ? brief.variants : [];
    return {
      id: brief.id ?? item.productId,
      categoryId: null,
      category: null,
      name: brief.name ?? 'Saved product',
      slug: brief.slug ?? '',
      description: null,
      shortDescription: null,
      brand: brief.brand ?? null,
      isActive: brief.isActive ?? true,
      isFeatured: false,
      variants: briefVariants.map((variant) => ({
        id: variant.id ?? null,
        productId: brief.id ?? item.productId,
        sku: variant.sku ?? null,
        name: variant.name ?? '',
        price: variant.price ?? null,
        compareAtPrice: null,
        barcode: null,
        weight: null,
        isActive: variant.isActive ?? true,
        createdAt: null,
        updatedAt: null,
      })),
      createdAt: item.createdAt ?? null,
      updatedAt: null,
    };
  };

  const handleMoveToCart = async (item) => {
    let product = getProductById(item.productId);
    if (!product) {
      await ensureProduct(item.productId);
      // Re-read post-fetch: the store updated asynchronously.
      product = useProductStore.getState().getProductById(item.productId);
    }
    const variant = product ? getDefaultVariant(product) : null;
    if (!variant) {
      // Provably unpurchasable (gone/inactive): drop the stale saved line
      // in guest mode with an explanation instead of keeping it forever.
      if (isGuest) {
        dropGuestEntries([item.productId]);
      }
      toast.error('This product has no purchasable variant right now.');
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
    if (!result.ok) {
      toast.error(result.error?.message ?? 'Could not move to cart.');
      return;
    }
    toast.success('Moved to cart.');
    await removeByItemId(item.id);
  };

  return (
    <Container className="flex flex-col gap-6 py-10 sm:py-14">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Wishlist' }]} />
      <h1 className="text-2xl font-bold tracking-tight">Your wishlist</h1>

      {isLoading && products.length === 0 ? (
        <ProductGridSkeleton count={8} />
      ) : status === 'error' && wishlist.items.length === 0 ? (
        <ErrorState
          title="Couldn’t load your wishlist"
          message={error?.message ?? 'Please check your connection and retry.'}
          onRetry={bootstrap}
        />
      ) : wishlist.items.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Nothing saved yet"
          message="Tap the heart on any product to save it here for later."
          actionTo="/shop"
          actionLabel="Discover products"
        />
      ) : (
        <>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {wishlist.itemCount} {wishlist.itemCount === 1 ? 'saved product' : 'saved products'}
          </p>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 xl:gap-6">
            {wishlist.items.map((item) => {
              const product = resolveProduct(item);
              if (!product) return null;
              return (
                <li key={item.id} className="flex min-w-0 flex-col gap-2">
                  <ProductCard product={product} showAdd={false} className="h-full flex-1" />
                  <button
                    type="button"
                    onClick={() => handleMoveToCart(item)}
                    className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-secondary-foreground transition-colors duration-200 hover:bg-surface-muted"
                  >
                    Move to cart
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Container>
  );
}
