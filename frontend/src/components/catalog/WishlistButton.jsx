import { Heart } from 'lucide-react';
import { toast } from 'sonner';
import { useWishlistStore } from '../../stores/useWishlistStore.js';
import { cn } from '../../lib/cn.js';

/**
 * Wishlist heart toggle (always visible, never hover-only). Works for
 * guests (persisted locally, merged on login) and authenticated users
 * (server-backed). Duplicate adds are absorbed server-side (`409` →
 * saved); toasts confirm outcomes.
 */
export function WishlistButton({ productId, productName, productSlug, productBrand, className }) {
  const isSaved = useWishlistStore((state) => state.isSaved(productId));
  const pendingProductId = useWishlistStore((state) => state.pendingProductId);
  const toggle = useWishlistStore((state) => state.toggle);

  if (!productId) return null;
  const pending = pendingProductId === productId;

  const handleClick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const result = await toggle(productId, {
      productName: productName ?? null,
      productSlug: productSlug ?? null,
      brand: productBrand ?? null,
    });
    if (result.ok) {
      toast.success(result.saved ? 'Saved to your wishlist.' : 'Removed from your wishlist.');
    } else if (result.error?.code === 'PRODUCT_INACTIVE' || result.error?.status === 422) {
      toast.error('This product is no longer available.');
    } else {
      toast.error(result.error?.message ?? 'Wishlist update failed. Please try again.');
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={isSaved ? `Remove ${productName ?? 'product'} from wishlist` : `Save ${productName ?? 'product'} to wishlist`}
      aria-pressed={isSaved}
      title={isSaved ? 'Saved to wishlist' : 'Save to wishlist'}
      className={cn(
        'inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-surface-elevated/90 shadow-sm backdrop-blur transition-all duration-200 hover:scale-105 disabled:cursor-wait disabled:opacity-70',
        isSaved ? 'text-accent' : 'text-muted-foreground hover:text-accent',
        className,
      )}
    >
      <Heart size={18} aria-hidden="true" fill={isSaved ? 'currentColor' : 'none'} className={pending ? 'animate-pulse' : undefined} />
    </button>
  );
}
