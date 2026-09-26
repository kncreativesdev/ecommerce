function formatDecimal(value, decimals) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value !== null && typeof value === "object" && typeof value.toFixed === "function") {
    return value.toFixed(decimals);
  }
  return String(value);
}

function moneyToCents(value) {
  const str = typeof value === "string" ? value : formatDecimal(value, 2);
  const dot = str.indexOf(".");
  const intPart = dot === -1 ? str : str.slice(0, dot);
  const fracPart = (dot === -1 ? "" : str.slice(dot + 1)).padEnd(2, "0").slice(0, 2);
  if (!/^\d+$/.test(intPart) || !/^\d{2}$/.test(fracPart)) {
    throw new Error("Invalid monetary value");
  }
  return BigInt(intPart === "" ? "0" : intPart) * 100n + BigInt(fracPart);
}

function centsToString(cents) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const units = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${units.toString()}.${frac}`;
}

function toSafeCoupon(coupon) {
  return {
    id: coupon.id,
    code: coupon.code,
    description: coupon.description ?? null,
    discountType: coupon.discountType,
    discountValue: formatDecimal(coupon.discountValue, 2),
    minimumOrderAmount: formatDecimal(coupon.minimumOrderAmount ?? null, 2),
    maximumDiscountAmount: formatDecimal(coupon.maximumDiscountAmount ?? null, 2),
    usageLimit: coupon.usageLimit ?? null,
    usedCount: coupon.usedCount ?? 0,
    startsAt: coupon.startsAt ?? null,
    expiresAt: coupon.expiresAt ?? null,
    isActive: coupon.isActive,
    products: (coupon.products || []).map((link) => ({
      productId: link.productId,
    })),
    createdAt: coupon.createdAt,
    updatedAt: coupon.updatedAt,
  };
}

module.exports = { formatDecimal, moneyToCents, centsToString, toSafeCoupon };
