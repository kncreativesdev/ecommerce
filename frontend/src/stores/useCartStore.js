import { create } from 'zustand';
import {
  addCartItem,
  fetchCart,
  removeCartItem,
  updateCartItemQuantity,
} from '../services/cart.service.js';
import { adaptCart, emptyCart, resolveGuestCart } from '../utils/cartAdapter.js';
import { loadGuestCart, saveGuestCart } from '../lib/guestStorage.js';
import { useProductStore } from './useProductStore.js';

/**
 * Cart state (Zustand) — server mirror when authenticated, guest-local
 * mirror otherwise (FRONTEND_ARCHITECTURE.md §6).
 *
 * - Authenticated: every mutation applies the FULL updated cart returned
 *   by the server (never local math). Add = increment, update = absolute,
 *   remove idempotent, no clear-all endpoint (iterate per-line deletes).
 * - Guest: entries (`{ variantId, productId, quantity, snapshot }`) live
 *   in `tp-guest-cart-v1` and resolve against the catalog cache into the
 *   SAME cart shape (display totals are client-computed estimates; the
 *   server recomputes authoritatively at checkout). Re-adding a variant
 *   increments locally, matching server semantics. No API calls are made.
 * - `sessionActive` is set by the auth store (never inferred here), so no
 *   store↔store import cycle exists. All consumers (page, badge, card)
 *   read the same `cart` shape in both modes.
 */

async function applyCartResult(promise, set) {
  // Per-item mutations must NOT flip the page-level `status` to 'loading':
  // CartPage/CheckoutPage render full-page skeletons on that flag, so every
  // quantity/remove click flashed the whole page like a document reload.
  // Row-level pending (`pendingItemId`/`bulkPending`, set by each caller)
  // already drives the targeted disabled states — clear only stale errors.
  set({ error: null });
  try {
    const cart = adaptCart(await promise);
    set({ cart: cart ?? emptyCart(), status: 'success', error: null });
    return { ok: true };
  } catch (error) {
    // Reconcile with the server before surfacing (stock races, races).
    try {
      const cart = adaptCart(await fetchCart());
      set({ cart: cart ?? emptyCart() });
    } catch {
      /* Keep the last known mirror on total failure. */
    }
    set({ status: 'success', error });
    return { ok: false, error };
  }
}

function initialGuestItems() {
  try {
    return loadGuestCart();
  } catch {
    return [];
  }
}

export const useCartStore = create((set, get) => ({
  cart: resolveGuestCart(initialGuestItems(), []),
  status: 'idle',
  error: null,
  /**
   * True once a usable cart snapshot exists (initial bootstrap settled or
   * synchronous guest view established). Lets `bootstrap()` refresh in the
   * background without flashing the full-page skeleton, and lets pages tell
   * "no data yet" apart from "refreshing known data". Reset when the
   * session mode changes because the previous mirror belongs to the other
   * mode. This is lifecycle metadata only — the `cart` mirror stays the
   * single source of cart data.
   */
  hydrated: false,
  /** Item id currently mutating (button spinners, double-submit guard). */
  pendingItemId: null,
  bulkPending: false,
  /** True once the auth store establishes a session; false for guests. */
  sessionActive: false,
  /** Raw guest entries (stable IDs); resolved into `cart` for rendering. */
  guestItems: initialGuestItems(),

  totalQuantity: () => get().cart.totalQuantity,
  itemCount: () => get().cart.itemCount,

  /** Auth store toggles the mode; the view recomputes accordingly. */
  setSessionActive: (active) => {
    const next = Boolean(active);
    if (next === get().sessionActive) return;
    // The previous mirror belongs to the other mode — drop back to the
    // initial lifecycle so the next bootstrap loads (with skeleton) instead
    // of briefly presenting the other mode's snapshot as current data.
    set({ sessionActive: next, status: 'idle', hydrated: false });
  },

  /** Re-resolve the guest view against the latest catalog (guest mode). */
  refreshGuestView: () => {
    if (get().sessionActive) return;
    const products = useProductStore.getState().products;
    set({ cart: resolveGuestCart(get().guestItems, products) });
  },

  bootstrap: async () => {
    if (!get().sessionActive) {
      // Guest path: no API calls — load persisted entries and resolve.
      // Synchronous, so no loading flash is possible here.
      set({ guestItems: loadGuestCart(), error: null });
      get().refreshGuestView();
      set({ status: 'success', hydrated: true });
      return;
    }
    const { status } = get();
    if (status === 'loading') return;
    // A usable snapshot already exists → background refresh: keep rendering
    // it instead of replacing the page with skeletons. Only the very first
    // load (or a post-session-change load) uses the page-level skeleton.
    if (get().hydrated) {
      set({ error: null });
    } else {
      set({ status: 'loading', error: null });
    }
    try {
      const cart = adaptCart(await fetchCart());
      set({ cart: cart ?? emptyCart(), status: 'success', error: null, hydrated: true });
    } catch (error) {
      if (get().hydrated && get().cart.items.length > 0) {
        // Background refresh failed but a usable snapshot exists — keep
        // rendering it (mirrors the mutation error pattern below). An
        // unconfirmed empty cart must still surface the error state.
        set({ error });
      } else {
        set({ status: 'error', error });
      }
    }
  },

  addItem: async ({ variantId, quantity, snapshot }) => {
    if (!get().sessionActive) {
      if (typeof variantId !== 'string' || variantId === '') {
        return { ok: false, error: new Error('Missing variant.') };
      }
      const qty = Math.max(1, Math.floor(Number(quantity) || 1));
      set({ bulkPending: true });
      try {
        const items = [...get().guestItems];
        const index = items.findIndex((entry) => entry.variantId === variantId);
        if (index >= 0) {
          items[index] = { ...items[index], quantity: items[index].quantity + qty };
        } else {
          items.push({
            variantId,
            productId: snapshot?.productId ?? null,
            quantity: qty,
            snapshot: snapshot ?? null,
            addedAt: new Date().toISOString(),
          });
        }
        saveGuestCart(items);
        set({ guestItems: items, error: null });
        get().refreshGuestView();
        return { ok: true };
      } finally {
        set({ bulkPending: false });
      }
    }
    set({ bulkPending: true });
    try {
      return await applyCartResult(addCartItem({ variantId, quantity }), set);
    } finally {
      set({ bulkPending: false });
    }
  },

  setQuantity: async (itemId, quantity) => {
    if (!get().sessionActive) {
      const qty = Math.max(1, Math.floor(Number(quantity) || 1));
      set({ pendingItemId: itemId });
      try {
        const items = get().guestItems.map((entry) =>
          `guest:${entry.variantId}` === itemId ? { ...entry, quantity: qty } : entry,
        );
        saveGuestCart(items);
        set({ guestItems: items, error: null });
        get().refreshGuestView();
        return { ok: true };
      } finally {
        set({ pendingItemId: null });
      }
    }
    set({ pendingItemId: itemId });
    try {
      return await applyCartResult(updateCartItemQuantity(itemId, quantity), set);
    } finally {
      set({ pendingItemId: null });
    }
  },

  removeItem: async (itemId) => {
    if (!get().sessionActive) {
      // Idempotent locally, mirroring the server's already-removed semantics.
      set({ pendingItemId: itemId });
      try {
        const items = get().guestItems.filter((entry) => `guest:${entry.variantId}` !== itemId);
        saveGuestCart(items);
        set({ guestItems: items, error: null });
        get().refreshGuestView();
        return { ok: true };
      } finally {
        set({ pendingItemId: null });
      }
    }
    set({ pendingItemId: itemId });
    try {
      const result = await applyCartResult(removeCartItem(itemId), set);
      if (!result.ok && (result.error?.code === 'CART_ITEM_NOT_FOUND' || result.error?.status === 404)) {
        // Already removed elsewhere — treat as idempotent success.
        return { ok: true };
      }
      return result;
    } finally {
      set({ pendingItemId: null });
    }
  },

  clearCart: async () => {
    if (!get().sessionActive) {
      set({ bulkPending: true });
      try {
        saveGuestCart([]);
        set({ guestItems: [], error: null });
        get().refreshGuestView();
        return { ok: true };
      } finally {
        set({ bulkPending: false });
      }
    }
    const items = get().cart.items;
    set({ bulkPending: true });
    try {
      for (const item of items) {
        try {
          const cart = adaptCart(await removeCartItem(item.id));
          set({ cart: cart ?? emptyCart() });
        } catch (error) {
          if (error?.status !== 404 && error?.code !== 'CART_ITEM_NOT_FOUND') throw error;
        }
      }
      const cart = adaptCart(await fetchCart());
      set({ cart: cart ?? emptyCart(), status: 'success', error: null });
      return { ok: true };
    } catch (error) {
      set({ status: 'success', error });
      return { ok: false, error };
    } finally {
      set({ bulkPending: false });
    }
  },

  /** Raw guest entries for the login merge coordinator. */
  getGuestEntries: () => [...get().guestItems],

  /** Drop merged entries (persisted); used only after server confirms. */
  dropGuestEntries: (variantIds) => {
    const drop = new Set(Array.isArray(variantIds) ? variantIds : []);
    if (drop.size === 0) return;
    const items = get().guestItems.filter((entry) => !drop.has(entry.variantId));
    saveGuestCart(items);
    set({ guestItems: items });
    get().refreshGuestView();
  },

  /**
   * Logout/de-auth cleanup — server cart persists server-side; the local
   * mirror switches to the independent guest view. Server data is NEVER
   * copied into guest storage here.
   */
  reset: () => {
    set({ sessionActive: false });
    set({ guestItems: loadGuestCart(), error: null });
    get().refreshGuestView();
    // Synchronous guest view — immediately usable, no loader needed.
    set({ status: 'success', hydrated: true, pendingItemId: null, bulkPending: false });
  },

  clearError: () => set({ error: null }),
}));

// Keep the guest view fresh as the catalog cache arrives/changes.
// One-directional subscription (product store never imports cart).
let lastProductsRef = null;
useProductStore.subscribe((state) => {
  if (state.products === lastProductsRef) return;
  lastProductsRef = state.products;
  useCartStore.getState().refreshGuestView();
});
