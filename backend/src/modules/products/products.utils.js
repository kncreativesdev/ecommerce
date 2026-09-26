function normalizeSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDecimal(value, decimals) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value !== null && typeof value === "object" && typeof value.toFixed === "function") {
    return value.toFixed(decimals);
  }
  return String(value);
}

function toSafeVariant(variant) {
  const base = {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    name: variant.name,
    price: formatDecimal(variant.price, 2),
    compareAtPrice: formatDecimal(variant.compareAtPrice ?? null, 2),
    barcode: variant.barcode ?? null,
    weight: formatDecimal(variant.weight ?? null, 3),
    isActive: variant.isActive,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
  // Backend inventory is the source of truth for availability. When the
  // repository embeds `inventory` (public product reads), expose a boolean
  // `inStock` derived from `quantity - reservedQuantity > 0`. Variants with
  // no inventory record cannot be purchased → `inStock: false` (consistent
  // with the dashboard uninitialized-stock snapshot). When `inventory` was
  // not selected (admin variant writes), omit the field rather than invent
  // a value. Exact quantities are never exposed publicly.
  if (variant.inventory !== undefined) {
    const record = variant.inventory;
    const inStock =
      record != null &&
      Number(record.quantity ?? 0) - Number(record.reservedQuantity ?? 0) > 0;
    base.inStock = inStock;
  }
  return base;
}

function toSafeProduct(product) {
  return {
    id: product.id,
    categoryId: product.categoryId,
    category: product.category
      ? {
          id: product.category.id,
          name: product.category.name,
          slug: product.category.slug,
        }
      : null,
    name: product.name,
    slug: product.slug,
    description: product.description ?? null,
    shortDescription: product.shortDescription ?? null,
    brand: product.brand ?? null,
    isActive: product.isActive,
    isFeatured: product.isFeatured,
    variants: (product.variants || []).map(toSafeVariant),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

module.exports = { normalizeSlug, toSafeVariant, toSafeProduct };
