/**
 * Deterministic default/main product image pick for admin rows.
 *
 * Same priority as the storefront card rule (see customer
 * `getDefaultVariantImage`): default variant (first active variant in
 * backend order) primary image first, then its first ordered image, then
 * legacy product-level primary / first image, else `null` (callers render
 * the placeholder). Variant galleries never leak across variants.
 */

function bySortOrder(images) {
  return [...images].sort((a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0));
}

function variantImages(allImages, variantId) {
  if (!Array.isArray(allImages) || !variantId) return [];
  return bySortOrder(allImages.filter((image) => image?.variantId === variantId));
}

function productLevelImages(allImages) {
  if (!Array.isArray(allImages)) return [];
  return bySortOrder(allImages.filter((image) => image?.variantId == null));
}

function primaryImageFor(images) {
  const list = bySortOrder(Array.isArray(images) ? images : []);
  if (list.length === 0) return null;
  return list.find((image) => image?.isPrimary) ?? list[0];
}

function displayImageForVariant(allImages, variantId) {
  const scoped = variantImages(allImages, variantId);
  const gallery = scoped.length > 0 ? scoped : productLevelImages(allImages);
  return primaryImageFor(gallery);
}

export function pickDefaultVariantImage(allImages, product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const defaultVariant = variants.find((variant) => variant?.isActive !== false) ?? null;
  return displayImageForVariant(allImages, defaultVariant?.id ?? null);
}
