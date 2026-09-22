import { create } from 'zustand';
import { addWishlistItem, fetchWishlist, removeWishlistItem } from '../services/wishlist.service.js';
import { adaptWishlist, emptyWishlist, resolveGuestWishlist } from '../utils/cartAdapter.js';
import { loadGuestWishlist, saveGuestWishlist } from '../lib/guestStorage.js';
import { useProductStore } from './useProductStore.js';

/**
 * Wishlist state (Zustand) — server mirror when authenticated, guest-local
 * mirror otherwise. Product-level only; guest entries (`{ productId,
 * snapshot }`) live in `tp-guest-wishlist-v1` and resolve against the
 * catalog cache into the SAME item shape, so hearts, badges, and cards
 * work unchanged in both modes. No API calls are made while guest.
 */

function initialGuestEntries() {
  try {
    return loadGuestWishlist();
  } catch {
    return [];
  }
}

export const useWishlistStore = create((set, get) => ({
  wishlist: resolveGuestWishlist(initialGuestEntries(), []),
  status: 'idle',
  error: null,
  pendingProductId: null,
  /** True once the auth store establishes a session; false for guests. */
  sessionActive: false,
  /** Raw guest entries (stable product IDs); resolved into `wishlist`. */
  guestItems: initialGuestEntries(),

  /** Auth store toggles the mode; the view recomputes accordingly. */
  setSessionActive: (active) => {
    set({ sessionActive: Boolean(active) });
  },

  /** Re-resolve the guest view against the latest catalog (guest mode). */
  refreshGuestView: () => {
    if (get().sessionActive) return;
    const products = useProductStore.getState().products;
    set({ wishlist: resolveGuestWishlist(get().guestItems, products) });
  },

  bootstrap: async () => {
    if (!get().sessionActive) {
      // Guest path: no API calls — load persisted entries and resolve.
      set({ guestItems: loadGuestWishlist(), error: null });
      get().refreshGuestView();
      set({ status: 'success' });
      return;
    }
    const { status } = get();
    if (status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      const wishlist = adaptWishlist(await fetchWishlist());
      set({ wishlist: wishlist ?? emptyWishlist(), status: 'success', error: null });
    } catch (error) {
      set({ status: 'error', error });
    }
  },

  isSaved: (productId) => {
    if (!productId) return false;
    return get().wishlist.items.some((item) => item.productId === productId);
  },

  findItemId: (productId) => {
    if (!productId) return null;
    return get().wishlist.items.find((item) => item.productId === productId)?.id ?? null;
  },

  toggle: async (productId, snapshot) => {
    if (!get().sessionActive) {
      if (typeof productId !== 'string' || productId === '') {
        return { ok: false, saved: false, error: new Error('Missing product.') };
      }
      set({ pendingProductId: productId, error: null });
      try {
        const items = [...get().guestItems];
        const index = items.findIndex((entry) => entry.productId === productId);
        let saved;
        if (index >= 0) {
          items.splice(index, 1);
          saved = false;
        } else {
          items.push({
            productId,
            snapshot: snapshot ?? null,
            addedAt: new Date().toISOString(),
          });
          saved = true;
        }
        saveGuestWishlist(items);
        set({ guestItems: items });
        get().refreshGuestView();
        return { ok: true, saved };
      } finally {
        set({ pendingProductId: null });
      }
    }
    const existingId = get().findItemId(productId);
    set({ pendingProductId: productId, error: null });
    try {
      if (existingId) {
        const wishlist = adaptWishlist(await removeWishlistItem(existingId));
        set({ wishlist: wishlist ?? emptyWishlist(), status: 'success' });
        return { ok: true, saved: false };
      }
      const wishlist = adaptWishlist(await addWishlistItem(productId));
      set({ wishlist: wishlist ?? emptyWishlist(), status: 'success' });
      return { ok: true, saved: true };
    } catch (error) {
      if (!existingId && (error?.code === 'WISHLIST_ITEM_EXISTS' || error?.status === 409)) {
        // Already saved elsewhere — reconcile and treat as saved.
        try {
          const wishlist = adaptWishlist(await fetchWishlist());
          set({ wishlist: wishlist ?? emptyWishlist(), status: 'success', error: null });
        } catch {
          set({ status: 'success' });
        }
        return { ok: true, saved: true };
      }
      if (existingId && (error?.status === 404 || error?.code === 'WISHLIST_ITEM_NOT_FOUND')) {
        try {
          const wishlist = adaptWishlist(await fetchWishlist());
          set({ wishlist: wishlist ?? emptyWishlist(), status: 'success', error: null });
        } catch {
          set({ status: 'success' });
        }
        return { ok: true, saved: false };
      }
      set({ status: 'success', error });
      return { ok: false, saved: !existingId, error };
    } finally {
      set({ pendingProductId: null });
    }
  },

  removeByItemId: async (itemId) => {
    if (!get().sessionActive) {
      // Guest ids are `guest:<productId>` — drop locally, always idempotent.
      const items = get().guestItems.filter((entry) => `guest:${entry.productId}` !== itemId);
      saveGuestWishlist(items);
      set({ guestItems: items, error: null });
      get().refreshGuestView();
      return { ok: true };
    }
    set({ status: 'loading', error: null });
    try {
      const wishlist = adaptWishlist(await removeWishlistItem(itemId));
      set({ wishlist: wishlist ?? emptyWishlist(), status: 'success', error: null });
      return { ok: true };
    } catch (error) {
      if (error?.status === 404) {
        try {
          const wishlist = adaptWishlist(await fetchWishlist());
          set({ wishlist: wishlist ?? emptyWishlist(), status: 'success', error: null });
        } catch {
          set({ status: 'success' });
        }
        return { ok: true };
      }
      set({ status: 'success', error });
      return { ok: false, error };
    }
  },

  /** Raw guest entries for the login merge coordinator. */
  getGuestEntries: () => [...get().guestItems],

  /** Drop merged entries (persisted); used only after server confirms. */
  dropGuestEntries: (productIds) => {
    const drop = new Set(Array.isArray(productIds) ? productIds : []);
    if (drop.size === 0) return;
    const items = get().guestItems.filter((entry) => !drop.has(entry.productId));
    saveGuestWishlist(items);
    set({ guestItems: items });
    get().refreshGuestView();
  },

  /**
   * Logout/de-auth cleanup — server wishlist persists server-side; the
   * local mirror switches to the independent guest view. Server data is
   * NEVER copied into guest storage here.
   */
  reset: () => {
    set({ sessionActive: false });
    set({ guestItems: loadGuestWishlist(), error: null });
    get().refreshGuestView();
    set({ status: 'success', pendingProductId: null });
  },

  clearError: () => set({ error: null }),
}));

// Keep the guest view fresh as the catalog cache arrives/changes.
// One-directional subscription (product store never imports wishlist).
let lastProductsRef = null;
useProductStore.subscribe((state) => {
  if (state.products === lastProductsRef) return;
  lastProductsRef = state.products;
  useWishlistStore.getState().refreshGuestView();
});
