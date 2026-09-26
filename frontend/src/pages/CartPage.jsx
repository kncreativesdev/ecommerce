import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ShoppingCart, UserRound } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { CartLine } from '../components/cart/CartLine.jsx';
import { CartSummary } from '../components/cart/CartSummary.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { useCartStore } from '../stores/useCartStore.js';
import { useProducts } from '../hooks/useProducts.js';

/**
 * Cart (`/cart`, guest-browsable): server cart when authenticated, guest
 * local cart otherwise — both through the same store shape. Mutations
 * reconcile with server responses when authenticated; `409
 * INSUFFICIENT_STOCK` highlights via toast + refreshed lines; `404` on
 * remove means already-removed. Guest totals are local estimates;
 * checkout re-validates everything server-side.
 */
export function CartPage() {
  const cart = useCartStore((state) => state.cart);
  const status = useCartStore((state) => state.status);
  const error = useCartStore((state) => state.error);
  const pendingItemId = useCartStore((state) => state.pendingItemId);
  const bulkPending = useCartStore((state) => state.bulkPending);
  const isGuest = useCartStore((state) => !state.sessionActive);
  const bootstrap = useCartStore((state) => state.bootstrap);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const clearCart = useCartStore((state) => state.clearCart);
  const clearError = useCartStore((state) => state.clearError);
  // Guest lines resolve against the live catalog (names/prices/active
  // flags). Subscribing here warms the single-flight catalog cache so a
  // direct load/refresh never strands guest lines as "unavailable".
  useProducts();

  useEffect(() => {
    document.title = 'Cart — Tech Pulse';
    bootstrap();
  }, [bootstrap]);

  const isLoading = status === 'idle' || status === 'loading';

  const handleSetQuantity = async (itemId, quantity) => {
    if (quantity < 1) return;
    const result = await setQuantity(itemId, quantity);
    if (!result.ok) {
      if (result.error?.code === 'INSUFFICIENT_STOCK' || result.error?.status === 409) {
        toast.error('This product is out of stock right now — cart refreshed.');
      } else if (result.error?.code === 'CART_ITEM_NOT_FOUND' || result.error?.status === 404) {
        toast.error('That item is no longer in your cart.');
      } else {
        toast.error(result.error?.message ?? 'Quantity update failed.');
      }
    }
  };

  const handleRemove = async (itemId) => {
    const result = await removeItem(itemId);
    if (result.ok) {
      toast.success('Removed from cart.');
    } else {
      toast.error(result.error?.message ?? 'Remove failed. Please try again.');
    }
  };

  const handleClear = async () => {
    const result = await clearCart();
    if (result.ok) {
      toast.success('Cart cleared.');
    } else {
      toast.error(result.error?.message ?? 'Could not clear the cart.');
    }
  };

  return (
    <Container className="flex flex-col gap-6 py-10 sm:py-14">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Cart' }]} />
      <h1 className="text-2xl font-bold tracking-tight">Your cart</h1>

      {isGuest && !isLoading && cart.items.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-muted px-4 py-3 text-[13px] leading-5 text-muted-foreground">
          <span>
            Shopping as a guest — totals are estimates confirmed at checkout.{' '}
            <Link to={`/login?redirect=${encodeURIComponent('/cart')}`} className="font-semibold text-accent-link hover:no-underline">
              <UserRound size={13} aria-hidden="true" className="mr-1 inline" />
              Sign in to sync across devices
            </Link>
          </span>
        </p>
      ) : null}

      {isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]" role="status" aria-label="Loading cart">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : status === 'error' && cart.items.length === 0 ? (
        <ErrorState
          title="Couldn’t load your cart"
          message={error?.message ?? 'Please check your connection and retry.'}
          onRetry={() => {
            clearError();
            bootstrap();
          }}
        />
      ) : cart.items.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty"
          message="Add some gadgets to get started — checkout is Cash on Delivery."
          actionTo="/shop"
          actionLabel="Continue shopping"
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
          <ul className="flex flex-col gap-4" aria-live="polite">
            {cart.items.map((line) => (
              <CartLine
                key={line.id}
                line={line}
                pending={pendingItemId === line.id || bulkPending}
                onSetQuantity={handleSetQuantity}
                onRemove={handleRemove}
              />
            ))}
          </ul>
          <CartSummary cart={cart} bulkPending={bulkPending} onClear={handleClear} />
        </div>
      )}
    </Container>
  );
}
