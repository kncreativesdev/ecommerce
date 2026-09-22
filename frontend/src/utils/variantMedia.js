/**
 * Variant-aware media selectors over the single
 * `GET /products/:productId/images` list (already `sortOrder` ordered by
 * the backend). One fetch per product (cached in the media components) —
 * variant galleries are a CLIENT-SIDE partition, never extra requests.
 *
 * Rules (mirror the backend pick order used for cart/order snapshots):
 * - A variant WITH images shows exactly its own images (primary first).
 * - A variant WITHOUT images falls back to the product-level images
 *   (`variantId: null`), so Variant B never shows Variant A images.
 * - `primaryImageFor` prefers `isPrimary`, else first in sort order.
 */

function bySortOrder(images) {
  return [...images].sort((a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0));
}

export function variantImages(allImages, variantId) {
  if (!Array.isArray(allImages) || !variantId) return [];
  return bySortOrder(allImages.filter((image) => image?.variantId === variantId));
}

export function productLevelImages(allImages) {
  if (!Array.isArray(allImages)) return [];
  return bySortOrder(allImages.filter((image) => image?.variantId == null));
}

/** Gallery for a selected variant, with product-level fallback. */
export function galleryForVariant(allImages, variantId) {
  const scoped = variantImages(allImages, variantId);
  if (scoped.length > 0) return scoped;
  return productLevelImages(allImages);
}

export function primaryImageFor(images) {
  const list = bySortOrder(Array.isArray(images) ? images : []);
  if (list.length === 0) return null;
  return list.find((image) => image?.isPrimary) ?? list[0];
}

/** Display image for a variant id (variant gallery or product fallback). */
export function displayImageForVariant(allImages, variantId) {
  return primaryImageFor(galleryForVariant(allImages, variantId));
}

/**
 * Deterministic product-card image rule (no customer-selected variant yet).
 *
 * Priority, in order — never random, never a sibling variant's image:
 * 1. default variant (first active variant in backend `createdAt` order)
 *    primary image (`isPrimary`, lowest `sortOrder` winning ties);
 * 2. default variant's first ordered image (`sortOrder` asc — the backend
 *    `GET /images` list already arrives in `sortOrder, createdAt` order);
 * 3. legacy product-level primary image (`variantId: null`, backward
 *    compatibility for catalog rows created before variant media);
 * 4. legacy product-level first ordered image;
 * 5. `null` → callers render the generic placeholder.
 *
 * A variant WITH images never falls through to product-level media, so
 * Variant A images can never appear on a card whose default variant is B.
 */
export function getDefaultVariantImage(allImages, product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const defaultVariant = variants.find((variant) => variant?.isActive !== false) ?? null;
  return displayImageForVariant(allImages, defaultVariant?.id ?? null);
}
