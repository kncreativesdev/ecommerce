/**
 * Cart/wishlist normalization. Backend shapes verified in
 * `cart.utils.js` (`toSafeCart`) and `wishlist.utils.js`
 * (`toSafeWishlist`) — money stays as decimal strings end-to-end.
 */

/** Normalize one cart line (server-computed totals preserved verbatim). */
export function adaptCartItem(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: item.id ?? null,
    variantId: item.variantId ?? null,
    quantity: Number.isInteger(item.quantity) ? item.quantity : 0,
    unitPrice: item.unitPrice ?? null,
    lineTotal: item.lineTotal ?? null,
    variant: item.variant
      ? {
          id: item.variant.id ?? null,
          sku: item.variant.sku ?? null,
          name: item.variant.name ?? '',
          price: item.variant.price ?? null,
          isActive: item.variant.isActive ?? true,
        }
      : null,
    product: item.product
      ? {
          id: item.product.id ?? null,
          name: item.product.name ?? '',
          slug: item.product.slug ?? '',
          isActive: item.product.isActive ?? true,
        }
      : null,
    createdAt: item.createdAt ?? null,
    updatedAt: item.updatedAt ?? null,
  };
}

/** Normalize the server cart mirror. Totals render verbatim — never recomputed. */
export function adaptCart(cart) {
  if (!cart || typeof cart !== 'object') return null;
  return {
    id: cart.id ?? null,
    items: Array.isArray(cart.items)
      ? cart.items.map(adaptCartItem).filter((item) => item && item.id)
      : [],
    totalQuantity: Number.isInteger(cart.totalQuantity) ? cart.totalQuantity : 0,
    itemCount: Number.isInteger(cart.itemCount) ? cart.itemCount : 0,
    subtotal: cart.subtotal ?? null,
    createdAt: cart.createdAt ?? null,
    updatedAt: cart.updatedAt ?? null,
  };
}

export function emptyCart() {
  return { id: null, items: [], totalQuantity: 0, itemCount: 0, subtotal: null, createdAt: null, updatedAt: null };
}

/** Normalize one wishlist line (product brief only — no variants/prices). */
export function adaptWishlistItem(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: item.id ?? null,
    productId: item.productId ?? null,
    product: item.product
      ? {
          id: item.product.id ?? null,
          name: item.product.name ?? '',
          slug: item.product.slug ?? '',
          brand: item.product.brand ?? null,
          isActive: item.product.isActive ?? true,
        }
      : null,
    createdAt: item.createdAt ?? null,
  };
}

/** Normalize the server wishlist mirror. */
export function adaptWishlist(wishlist) {
  if (!wishlist || typeof wishlist !== 'object') return null;
  return {
    id: wishlist.id ?? null,
    items: Array.isArray(wishlist.items)
      ? wishlist.items.map(adaptWishlistItem).filter((item) => item && item.id)
      : [],
    itemCount: Number.isInteger(wishlist.itemCount) ? wishlist.itemCount : 0,
    createdAt: wishlist.createdAt ?? null,
    updatedAt: wishlist.updatedAt ?? null,
  };
}

export function emptyWishlist() {
  return { id: null, items: [], itemCount: 0, createdAt: null, updatedAt: null };
}

/* ------------------------------------------------------------------ */
/* Guest (local-only) cart resolution.                                 */
/*                                                                     */
/* Guest entries store stable IDs (`variantId`, `productId`) plus a     */
/* display snapshot captured at add-time. Resolution prefers LIVE       */
/* catalog data (current names/prices, active flags); snapshots are     */
/* fallbacks so guest UI renders before/rails the catalog cache.       */
/*                                                                     */
/* Display totals below are computed client-side for guest rendering    */
/* ONLY via integer-cents math. They are estimates — the server        */
/* recomputes all totals authoritatively at checkout. Never present     */
/* guest totals as server values.                                      */
/* ------------------------------------------------------------------ */

/** Stable local id for a guest line (one line per variant, like server). */
export function guestCartLineId(variantId) {
  return `guest:${variantId}`;
}

/** Stable local id for a guest wishlist line. */
export function guestWishlistLineId(productId) {
  return `guest:${productId}`;
}

function priceToCents(price) {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function centsToDecimalString(cents) {
  const safe = Number.isInteger(cents) && cents >= 0 ? cents : 0;
  return `${Math.floor(safe / 100)}.${String(safe % 100).padStart(2, '0')}`;
}

function findCatalogVariant(products, entry) {
  const list = Array.isArray(products) ? products : [];
  if (entry.productId) {
    const product = list.find((item) => item && item.id === entry.productId);
    const variant = product?.variants?.find((item) => item && item.id === entry.variantId);
    if (product && variant) return { product, variant };
  }
  // Fall back to a catalog-wide variant scan when productId is unknown.
  for (const product of list) {
    const variant = product?.variants?.find((item) => item && item.id === entry.variantId);
    if (variant) return { product, variant };
  }
  return { product: null, variant: null };
}

/**
 * Resolve one guest entry to the shared cart-line shape
 * (`guest: true`, plus `unavailable: true` when the variant is missing or
 * inactive in the live catalog). Unavailable lines keep snapshot display
 * data and support removal only.
 */
export function resolveGuestCartLine(entry, products) {
  const snapshot = entry.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : {};
  const { product, variant } = findCatalogVariant(products, entry);
  const live = Boolean(variant && variant.isActive !== false && product && product.isActive !== false);

  const productName = live ? product.name : (snapshot.productName ?? 'Saved item');
  const productSlug = live ? (product.slug ?? '') : (snapshot.productSlug ?? '');
  const variantName = live ? (variant.name ?? '') : (snapshot.variantName ?? '');
  const unitPrice = live ? (variant.price ?? snapshot.unitPrice ?? null) : (snapshot.unitPrice ?? null);
  const cents = priceToCents(unitPrice);
  const lineTotal = cents === null ? null : centsToDecimalString(cents * entry.quantity);

  return {
    id: guestCartLineId(entry.variantId),
    variantId: entry.variantId,
    quantity: entry.quantity,
    unitPrice,
    lineTotal,
    variant: {
      id: entry.variantId,
      sku: live ? (variant.sku ?? null) : (snapshot.sku ?? null),
      name: variantName,
      price: unitPrice,
      isActive: live,
    },
    product: {
      id: entry.productId ?? product?.id ?? null,
      name: productName,
      slug: productSlug,
      isActive: live,
    },
    createdAt: entry.addedAt ?? null,
    updatedAt: null,
    guest: true,
    unavailable: !live,
  };
}

/**
 * Resolve guest entries to the shared cart shape. Purchasable totals cover
 * available lines only; unavailable lines stay visible for removal.
 */
export function resolveGuestCart(entries, products) {
  const list = Array.isArray(entries) ? entries : [];
  const items = list.map((entry) => resolveGuestCartLine(entry, products));
  const purchasable = items.filter((item) => !item.unavailable);
  let totalQuantity = 0;
  let subtotalCents = 0;
  for (const item of purchasable) {
    totalQuantity += item.quantity;
    const cents = priceToCents(item.unitPrice);
    if (cents !== null) subtotalCents += cents * item.quantity;
  }
  return {
    id: 'guest',
    items,
    totalQuantity,
    itemCount: items.length,
    subtotal: purchasable.length > 0 ? centsToDecimalString(subtotalCents) : null,
    createdAt: null,
    updatedAt: null,
    guest: true,
  };
}

/**
 * Resolve one guest wishlist entry to the shared wishlist-item shape so
 * wishlist UI (hearts, badges, cards) works unchanged in guest mode.
 */
export function resolveGuestWishlistItem(entry, products) {
  const snapshot = entry.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : {};
  const product =
    (Array.isArray(products) ? products : []).find((item) => item && item.id === entry.productId) ?? null;
  const name = product?.name ?? snapshot.productName ?? 'Saved product';
  return {
    id: guestWishlistLineId(entry.productId),
    productId: entry.productId,
    product: {
      id: entry.productId,
      name,
      slug: product?.slug ?? snapshot.productSlug ?? '',
      brand: product?.brand ?? snapshot.brand ?? null,
      isActive: product ? product.isActive !== false : true,
    },
    createdAt: entry.addedAt ?? null,
    guest: true,
  };
}

/** Resolve guest wishlist entries to the shared wishlist shape. */
export function resolveGuestWishlist(entries, products) {
  const list = Array.isArray(entries) ? entries : [];
  const items = list.map((entry) => resolveGuestWishlistItem(entry, products));
  return {
    id: 'guest',
    items,
    itemCount: items.length,
    createdAt: null,
    updatedAt: null,
    guest: true,
  };
}
