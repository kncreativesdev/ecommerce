import { toast } from 'sonner';
import { addCartItem } from '../services/cart.service.js';
import { addWishlistItem } from '../services/wishlist.service.js';
import { useCartStore } from '../stores/useCartStore.js';
import { useWishlistStore } from '../stores/useWishlistStore.js';

/**
 * Guest→server merge coordinator (login / session-restore only).
 *
 * - Runs at most once per authenticated user per page lifetime
 *   (`mergeUserId` guard, reset on logout/de-auth) plus a single-flight
 *   guard, so repeated renders, StrictMode remounts, and overlapping
 *   login+bootstrap calls can never merge twice.
 * - Cart: one `POST /cart/items` per guest line. The backend combines
 *   quantities into the existing variant row server-side, so duplicates
 *   are impossible by construction. `409`/`422` lines (stock, inactive)
 *   stay in guest storage.
 * - Wishlist: one `POST /wishlist/items` per guest product. `409
 *   WISHLIST_ITEM_EXISTS` is absorbed as already-saved (dropped locally).
 * - Guest storage is cleared ONLY per item after its server call
 *   succeeds. Anything unsynced is preserved locally — never silently
 *   deleted — and a concise toast summarizes partial failure.
 * - Auth failure mid-merge stops the loop quietly; leftovers survive for
 *   the next login. This function never throws.
 */

let mergeUserId = null;
let mergeInflight = null;

/** Reset merge guards (logout / session loss). Next login may merge again. */
export function resetGuestSync() {
  mergeUserId = null;
  mergeInflight = null;
}

function isAuthError(error) {
  return (
    error?.status === 401 ||
    error?.code === 'AUTH_UNAUTHORIZED' ||
    error?.code === 'AUTH_TOKEN_INVALID' ||
    error?.code === 'AUTH_REFRESH_TOKEN_INVALID'
  );
}

/**
 * Merge guest data into the account of `user`. Resolves
 * `{ didMerge }` — true when server writes happened (mirrors were
 * refreshed), so callers can skip a redundant mirror bootstrap.
 */
export function syncGuestAfterAuth(user) {
  const userId = user?.id ?? null;
  if (!userId) return Promise.resolve({ didMerge: false });
  if (mergeUserId === userId) return Promise.resolve({ didMerge: false });
  if (mergeInflight) return mergeInflight;
  mergeInflight = runMerge(userId)
    .catch(() => ({ didMerge: false }))
    .finally(() => {
      mergeInflight = null;
    });
  return mergeInflight;
}

async function mergeGuestCart() {
  const store = useCartStore.getState();
  const entries = store.getGuestEntries();
  if (entries.length === 0) return { merged: 0, failed: 0, processed: false };

  let merged = 0;
  let failed = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    try {
      // Server increment semantics combine with any existing row.
      await addCartItem({ variantId: entry.variantId, quantity: entry.quantity });
      store.dropGuestEntries([entry.variantId]);
      merged += 1;
    } catch (error) {
      failed += 1;
      if (isAuthError(error)) {
        // Session died mid-merge: stop; everything remaining is preserved.
        break;
      }
      // Stock/validation failures stay local; continue with the rest.
    }
  }
  // Single mirror refresh reconciles combined quantities and failures.
  try {
    await store.bootstrap();
  } catch {
    /* Mirror keeps last state; page retry surfaces failures. */
  }
  return { merged, failed, processed: true };
}

async function mergeGuestWishlist() {
  const store = useWishlistStore.getState();
  const entries = store.getGuestEntries();
  if (entries.length === 0) return { merged: 0, failed: 0, processed: false };

  let merged = 0;
  let failed = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    try {
      await addWishlistItem(entry.productId);
      store.dropGuestEntries([entry.productId]);
      merged += 1;
    } catch (error) {
      if (error?.code === 'WISHLIST_ITEM_EXISTS' || error?.status === 409) {
        // Already on the server — absorb as saved, drop locally.
        store.dropGuestEntries([entry.productId]);
        merged += 1;
        continue;
      }
      failed += 1;
      if (isAuthError(error)) break;
    }
  }
  try {
    await store.bootstrap();
  } catch {
    /* Mirror keeps last state; page retry surfaces failures. */
  }
  return { merged, failed, processed: true };
}

async function runMerge(userId) {
  const cartResult = await mergeGuestCart();
  const wishResult = await mergeGuestWishlist();
  // Mark done even on partial failure: leftovers are preserved locally
  // without auto-retry storms; the next login may merge again.
  mergeUserId = userId;

  const merged = cartResult.merged + wishResult.merged;
  const failed = cartResult.failed + wishResult.failed;
  if (merged > 0 && failed === 0) {
    toast.success(
      merged === 1 ? 'Your saved item was merged into your account.' : `Your ${merged} saved items were merged into your account.`,
    );
  } else if (merged > 0 && failed > 0) {
    toast.error('Some saved items couldn’t be merged and were kept locally.');
  } else if (merged === 0 && failed > 0) {
    toast.error('Saved items couldn’t be merged yet — they’re kept locally.');
  }
  return { didMerge: cartResult.processed || wishResult.processed };
}
