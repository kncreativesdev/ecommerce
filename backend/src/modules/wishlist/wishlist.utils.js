function formatDecimal(value, decimals) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value !== null && typeof value === "object" && typeof value.toFixed === "function") {
    return value.toFixed(decimals);
  }
  return String(value);
}

function toSafeWishlistItem(item) {
  return {
    id: item.id,
    productId: item.productId,
    product: {
      id: item.product.id,
      name: item.product.name,
      slug: item.product.slug,
      brand: item.product.brand ?? null,
      isActive: item.product.isActive,
      variants: (item.product.variants || []).map((variant) => ({
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        price: formatDecimal(variant.price, 2),
        isActive: variant.isActive,
      })),
    },
    createdAt: item.createdAt,
  };
}

function toSafeWishlist(wishlist) {
  const items = (wishlist.items || []).map(toSafeWishlistItem);
  return {
    id: wishlist.id,
    items,
    itemCount: items.length,
    createdAt: wishlist.createdAt,
    updatedAt: wishlist.updatedAt,
  };
}

module.exports = { toSafeWishlist, toSafeWishlistItem };
