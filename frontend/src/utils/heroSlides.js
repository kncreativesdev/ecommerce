/**
 * Hero slide product selection: pure derivation over the loaded catalog
 * cache (no fetching — HomePage already holds `products` via useProducts).
 *
 * A hero candidate is an active product with at least one active variant
 * whose name mentions a watch (`/watch/i`, e.g. "Yo Watch"). Catalog order
 * is preserved (deterministic — never random, never popularity), capped at
 * `HERO_MAX_SLIDES`. The carousel renders `min(3, available)` real slides:
 * 3 images → 3 slides, 2 → 2, 1 → 1, 0 → the static hero fallback.
 */

export const HERO_MAX_SLIDES = 3;

function isPurchasable(product) {
  if (!product || product.isActive === false) return false;
  return (
    Array.isArray(product.variants) &&
    product.variants.some((variant) => variant?.isActive !== false)
  );
}

export function isWatchProduct(product) {
  return (
    typeof product?.name === 'string' &&
    product.name.toLowerCase().includes('watch') &&
    isPurchasable(product)
  );
}

/** Watch products in catalog order, capped for the hero. */
export function selectHeroWatchProducts(products, limit = HERO_MAX_SLIDES) {
  return (products ?? []).filter(isWatchProduct).slice(0, limit);
}
