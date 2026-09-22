/**
 * Guest persistence helpers — browser-level localStorage only.
 *
 * Keys follow the existing `tp-*` convention and are VERSIONED so future
 * shape changes can migrate or discard stale payloads:
 * - `tp-guest-cart-v1`: [{ variantId, productId, quantity, snapshot, addedAt }]
 * - `tp-guest-wishlist-v1`: [{ productId, snapshot, addedAt }]
 *
 * Snapshots are display fallbacks (names/prices captured at add-time) so
 * guest UI renders even before the catalog cache loads. Live catalog data
 * always wins during resolution (see `resolveGuestCart` in cartAdapter).
 *
 * NEVER stores auth access tokens or refresh tokens here — session tokens
 * stay in memory (auth store) and HttpOnly cookies respectively.
 */

export const GUEST_CART_KEY = 'tp-guest-cart-v1';
export const GUEST_WISHLIST_KEY = 'tp-guest-wishlist-v1';

function readArray(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupted/unreadable payloads reset to empty rather than crashing.
    return [];
  }
}

function writeArray(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private-mode/quota failures: guest data stays in memory for the tab.
  }
}

function isValidCartEntry(entry) {
  return (
    entry &&
    typeof entry === 'object' &&
    typeof entry.variantId === 'string' &&
    entry.variantId !== '' &&
    Number.isInteger(entry.quantity) &&
    entry.quantity >= 1
  );
}

function isValidWishlistEntry(entry) {
  return entry && typeof entry === 'object' && typeof entry.productId === 'string' && entry.productId !== '';
}

/** Load validated guest cart entries (stable IDs + quantities + snapshots). */
export function loadGuestCart() {
  return readArray(GUEST_CART_KEY).filter(isValidCartEntry).map((entry) => ({
    variantId: entry.variantId,
    productId: typeof entry.productId === 'string' ? entry.productId : null,
    quantity: entry.quantity,
    snapshot: entry.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : null,
    addedAt: typeof entry.addedAt === 'string' ? entry.addedAt : null,
  }));
}

/** Persist guest cart entries (raw IDs + snapshots, never tokens). */
export function saveGuestCart(entries) {
  writeArray(GUEST_CART_KEY, Array.isArray(entries) ? entries : []);
}

/** Remove persisted guest cart (only after successful server sync). */
export function clearGuestCart() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(GUEST_CART_KEY);
  } catch {
    /* Non-fatal; in-memory state remains authoritative for the tab. */
  }
}

/** Load validated guest wishlist entries (stable product IDs). */
export function loadGuestWishlist() {
  return readArray(GUEST_WISHLIST_KEY).filter(isValidWishlistEntry).map((entry) => ({
    productId: entry.productId,
    snapshot: entry.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : null,
    addedAt: typeof entry.addedAt === 'string' ? entry.addedAt : null,
  }));
}

/** Persist guest wishlist entries. */
export function saveGuestWishlist(entries) {
  writeArray(GUEST_WISHLIST_KEY, Array.isArray(entries) ? entries : []);
}

/** Remove persisted guest wishlist (only after successful server sync). */
export function clearGuestWishlist() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(GUEST_WISHLIST_KEY);
  } catch {
    /* Non-fatal; in-memory state remains authoritative for the tab. */
  }
}
