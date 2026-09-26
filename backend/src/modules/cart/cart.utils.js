function formatDecimal(value, decimals) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value !== null && typeof value === "object" && typeof value.toFixed === "function") {
    return value.toFixed(decimals);
  }
  return String(value);
}

function priceToCents(value) {
  const str = formatDecimal(value, 2);
  const dot = str.indexOf(".");
  const intPart = dot === -1 ? str : str.slice(0, dot);
  const fracPart = (dot === -1 ? "" : str.slice(dot + 1)).padEnd(2, "0").slice(0, 2);
  return BigInt(intPart === "" ? "0" : intPart) * 100n + BigInt(fracPart);
}

function centsToString(cents) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const units = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${units.toString()}.${frac}`;
}

function pickDisplayImage(variantImages, productImages) {
  const ordered = (list) => [...(list || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const vImages = ordered(variantImages);
  const pImages = ordered(productImages);
  const pick = vImages.find((image) => image.isPrimary) ?? vImages[0] ?? null;
  if (pick) return pick;
  return pImages.find((image) => image.isPrimary) ?? pImages[0] ?? null;
}

function toSafeCartItem(item) {
  const unitPrice = formatDecimal(item.variant.price, 2);
  const lineTotal = centsToString(priceToCents(item.variant.price) * BigInt(item.quantity));
  // Display image resolved server-side (variant primary → variant first →
  // product primary → product first). Guest/legacy lines without it fall
  // back to variant-aware media fetches client-side.
  const displayImage = pickDisplayImage(item.variant.images, item.variant.product.images);
  // Backend inventory is the source of truth for stock state. Variants with
  // no inventory record cannot be purchased → `inStock: false`.
  const inventory = item.variant.inventory ?? null;
  const inStock =
    inventory != null &&
    Number(inventory.quantity ?? 0) - Number(inventory.reservedQuantity ?? 0) > 0;
  return {
    id: item.id,
    variantId: item.variantId,
    quantity: item.quantity,
    unitPrice,
    lineTotal,
    inStock,
    image: displayImage
      ? { storagePath: displayImage.storagePath, altText: displayImage.altText ?? null }
      : null,
    variant: {
      id: item.variant.id,
      sku: item.variant.sku,
      name: item.variant.name,
      price: unitPrice,
      isActive: item.variant.isActive,
      inStock,
    },
    product: {
      id: item.variant.product.id,
      name: item.variant.product.name,
      slug: item.variant.product.slug,
      isActive: item.variant.product.isActive,
    },
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toSafeCart(cart) {
  const items = (cart.items || []).map(toSafeCartItem);
  let totalQuantity = 0;
  let subtotalCents = 0n;
  for (const item of items) {
    totalQuantity += item.quantity;
    const dot = item.lineTotal.indexOf(".");
    const units = item.lineTotal.slice(0, dot);
    const frac = item.lineTotal.slice(dot + 1);
    subtotalCents += BigInt(units) * 100n + BigInt(frac);
  }
  return {
    id: cart.id,
    items,
    totalQuantity,
    itemCount: items.length,
    subtotal: centsToString(subtotalCents),
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}

module.exports = { toSafeCart, toSafeCartItem, priceToCents, centsToString };
