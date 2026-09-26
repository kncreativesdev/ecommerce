const { AppError } = require("../../utils/appError");
const couponsRepository = require("./coupons.repository");
const cartRepository = require("../cart/cart.repository");
const { toSafeCoupon, moneyToCents, centsToString } = require("./coupons.utils");
const {
  normalizeCouponCode,
  couponCodeSchema,
  couponOrderLinesSchema,
} = require("./coupons.validation");

function percentageOf(baseCents, percentCents) {
  return (baseCents * percentCents + 5000n) / 10000n;
}

function calculateDiscountAmount(coupon, eligibleCents) {
  if (coupon.discountType === "PERCENTAGE") {
    const percentCents = moneyToCents(coupon.discountValue);
    if (percentCents <= 0n || percentCents > 10000n) {
      throw new AppError(422, "COUPON_INVALID_DISCOUNT", "Coupon discount value is invalid");
    }
    return percentageOf(eligibleCents, percentCents);
  }
  if (coupon.discountType === "FIXED") {
    const fixedCents = moneyToCents(coupon.discountValue);
    if (fixedCents <= 0n) {
      throw new AppError(422, "COUPON_INVALID_DISCOUNT", "Coupon discount value is invalid");
    }
    return fixedCents < eligibleCents ? fixedCents : eligibleCents;
  }
  throw new AppError(422, "COUPON_INVALID_DISCOUNT", "Coupon discount type is not supported");
}

function applyDiscountCap(coupon, amountCents) {
  if (coupon.maximumDiscountAmount === null || coupon.maximumDiscountAmount === undefined) {
    return amountCents;
  }
  const capCents = moneyToCents(coupon.maximumDiscountAmount);
  return amountCents < capCents ? amountCents : capCents;
}

async function validateCouponForOrder(input, now) {
  const code = normalizeCouponCode(couponCodeSchema.parse(input.code));
  const lines = couponOrderLinesSchema.parse(input.lines);
  const at = now instanceof Date ? now : new Date();

  const coupon = await couponsRepository.findCouponByCode(code);
  if (!coupon) {
    throw new AppError(404, "COUPON_NOT_FOUND", "Coupon not found");
  }
  if (!coupon.isActive) {
    throw new AppError(422, "COUPON_INACTIVE", "Coupon is not active");
  }
  if (coupon.startsAt && at < coupon.startsAt) {
    throw new AppError(422, "COUPON_NOT_YET_VALID", "Coupon is not yet valid");
  }
  if (coupon.expiresAt && at > coupon.expiresAt) {
    throw new AppError(422, "COUPON_EXPIRED", "Coupon has expired");
  }
  if (coupon.usageLimit !== null && coupon.usageLimit !== undefined && coupon.usedCount >= coupon.usageLimit) {
    throw new AppError(409, "COUPON_USAGE_LIMIT_EXCEEDED", "Coupon usage limit has been exceeded");
  }

  const restrictedIds =
    coupon.products && coupon.products.length > 0
      ? new Set(coupon.products.map((link) => link.productId))
      : null;
  const eligibleLines = restrictedIds ? lines.filter((line) => restrictedIds.has(line.productId)) : lines;
  if (eligibleLines.length === 0) {
    throw new AppError(422, "COUPON_NOT_APPLICABLE", "Coupon does not apply to the ordered products");
  }

  let orderCents = 0n;
  for (const line of lines) {
    orderCents += moneyToCents(line.lineTotal);
  }
  let eligibleCents = 0n;
  for (const line of eligibleLines) {
    eligibleCents += moneyToCents(line.lineTotal);
  }

  if (
    coupon.minimumOrderAmount !== null &&
    coupon.minimumOrderAmount !== undefined &&
    orderCents < moneyToCents(coupon.minimumOrderAmount)
  ) {
    throw new AppError(422, "COUPON_MINIMUM_ORDER_NOT_MET", "Order does not meet the coupon minimum amount");
  }

  const uncapped = calculateDiscountAmount(coupon, eligibleCents);
  const discountCents = applyDiscountCap(coupon, uncapped);

  return {
    coupon: toSafeCoupon(coupon),
    discountAmount: centsToString(discountCents),
    eligibleSubtotal: centsToString(eligibleCents),
    orderSubtotal: centsToString(orderCents),
  };
}

async function consumeCouponUsage(couponId) {
  const result = await couponsRepository.tryConsumeUsage(couponId);
  if (result.outcome === "missing") {
    throw new AppError(404, "COUPON_NOT_FOUND", "Coupon not found");
  }
  if (result.outcome === "exhausted") {
    throw new AppError(409, "COUPON_USAGE_LIMIT_EXCEEDED", "Coupon usage limit has been exceeded");
  }
  return { couponId, usedCount: result.usedCount };
}

/**
 * Customer checkout preview: validates a coupon code against the CALLER'S
 * current cart (lines are read server-side — the client never supplies
 * product/price data). Returns the authoritative discount quote the
 * checkout will apply if the cart is unchanged at order time; order
 * placement re-validates and consumes usage atomically.
 */
async function validateCouponForUserCart(userId, code) {
  const normalized = normalizeCouponCode(couponCodeSchema.parse(code));
  const cart = await cartRepository.findCartWithItemsByUserId(userId);
  const items = cart ? cart.items : [];
  if (items.length === 0) {
    throw new AppError(422, "ORDER_EMPTY_CART", "Cart is empty");
  }
  const lines = items.map((item) => ({
    productId: item.variant.productId,
    lineTotal: centsToString(moneyToCents(item.variant.price) * BigInt(item.quantity)),
  }));
  return validateCouponForOrder({ code: normalized, lines });
}

const ADMIN_DEFAULT_PAGE = 1;
const ADMIN_DEFAULT_LIMIT = 20;
const ADMIN_MAX_LIMIT = 100;

/** Mirror of products normalizeDecimal: non-negative, ≤2 decimals, ≤8 int digits. */
function normalizeMoneyInput(value, field) {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^\d+(\.\d+)?$/.test(raw)) {
    throw new AppError(422, "VALIDATION_ERROR", `${field} must be a valid non-negative amount`);
  }
  const dot = raw.indexOf(".");
  const intPart = (dot === -1 ? raw : raw.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const fracPart = dot === -1 ? "" : raw.slice(dot + 1);
  if (fracPart.length > 2) {
    throw new AppError(422, "VALIDATION_ERROR", `${field} must have at most 2 decimal places`);
  }
  if (intPart.length > 8) {
    throw new AppError(422, "VALIDATION_ERROR", `${field} exceeds the maximum supported value`);
  }
  return `${intPart}.${fracPart.padEnd(2, "0")}`;
}

function parseDateTimeInput(value, field) {
  if (value === null || value === undefined) {
    return null;
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new AppError(422, "VALIDATION_ERROR", `Invalid ${field}. Use an ISO-8601 date-time string.`);
  }
  return new Date(time);
}

/**
 * Enforces the same discount rules the checkout validator applies
 * (calculateDiscountAmount): PERCENTAGE in (0, 100], FIXED > 0. Rejecting
 * invalid values at write time keeps unusable coupons out of the system;
 * the validator remains authoritative at apply time.
 */
function assertDiscountSemantics(discountType, normalizedValue) {
  const cents = moneyToCents(normalizedValue);
  if (discountType === "PERCENTAGE") {
    if (cents <= 0n || cents > 10000n) {
      throw new AppError(422, "COUPON_INVALID_DISCOUNT", "Percentage discount must be above 0 and at most 100");
    }
    return;
  }
  if (discountType === "FIXED") {
    if (cents <= 0n) {
      throw new AppError(422, "COUPON_INVALID_DISCOUNT", "Fixed discount must be above 0");
    }
    return;
  }
  throw new AppError(422, "COUPON_INVALID_DISCOUNT", "Coupon discount type is not supported");
}

function assertDateOrder(startsAt, expiresAt) {
  if (startsAt && expiresAt && expiresAt <= startsAt) {
    throw new AppError(422, "VALIDATION_ERROR", "Expiry must be after the start date");
  }
}

function isCouponCodeConflict(err) {
  if (err.code !== "P2002") {
    return false;
  }
  const meta = err.meta || {};
  if (Array.isArray(meta.target)) {
    return meta.target.map(String).join(",").toLowerCase().includes("code");
  }
  return true;
}

async function assertUniqueCode(code, excludeId) {
  const existing = await couponsRepository.findCouponByCode(code);
  if (existing && existing.id !== excludeId) {
    throw new AppError(409, "COUPON_CODE_EXISTS", "A coupon with this code already exists");
  }
}

async function normalizeProductIds(productIds) {
  if (productIds === undefined) {
    return undefined;
  }
  const unique = [...new Set(productIds)];
  if (unique.length === 0) {
    return [];
  }
  const found = await couponsRepository.findExistingProductIds(unique);
  if (found.length !== unique.length) {
    const missing = unique.filter((id) => !found.includes(id));
    throw new AppError(404, "PRODUCT_NOT_FOUND", `Referenced product not found: ${missing[0]}`);
  }
  return unique;
}

async function getCoupon(id) {
  const row = await couponsRepository.findCouponById(id);
  if (!row) {
    throw new AppError(404, "COUPON_NOT_FOUND", "Coupon not found");
  }
  return toSafeCoupon(row);
}

async function listCouponsAdmin(query) {
  const page = query.page ?? ADMIN_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? ADMIN_DEFAULT_LIMIT, ADMIN_MAX_LIMIT);
  const search = query.search ? query.search.trim() : "";
  const { rows, total } = await couponsRepository.findCouponsAdmin({
    status: query.status ?? "all",
    search: search === "" ? null : search,
    skip: (page - 1) * limit,
    take: limit,
  });
  return {
    coupons: rows.map(toSafeCoupon),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function createCoupon(input) {
  const code = normalizeCouponCode(couponCodeSchema.parse(input.code));
  if (code === "") {
    throw new AppError(422, "VALIDATION_ERROR", "Coupon code must not be empty");
  }
  await assertUniqueCode(code, null);

  const discountValue = normalizeMoneyInput(input.discountValue, "discountValue");
  assertDiscountSemantics(input.discountType, discountValue);
  const minimumOrderAmount =
    input.minimumOrderAmount === null || input.minimumOrderAmount === undefined
      ? null
      : normalizeMoneyInput(input.minimumOrderAmount, "minimumOrderAmount");
  const maximumDiscountAmount =
    input.maximumDiscountAmount === null || input.maximumDiscountAmount === undefined
      ? null
      : normalizeMoneyInput(input.maximumDiscountAmount, "maximumDiscountAmount");
  const startsAt = parseDateTimeInput(input.startsAt ?? null, "startsAt");
  const expiresAt = parseDateTimeInput(input.expiresAt ?? null, "expiresAt");
  assertDateOrder(startsAt, expiresAt);
  const productIds = await normalizeProductIds(input.productIds);

  const data = {
    code,
    description: input.description ?? null,
    discountType: input.discountType,
    discountValue,
    minimumOrderAmount,
    maximumDiscountAmount,
    usageLimit: input.usageLimit ?? null,
    startsAt,
    expiresAt,
    isActive: input.isActive ?? true,
  };

  try {
    const id = await couponsRepository.createCouponRecord(data, productIds);
    return getCoupon(id);
  } catch (err) {
    if (isCouponCodeConflict(err)) {
      throw new AppError(409, "COUPON_CODE_EXISTS", "A coupon with this code already exists");
    }
    throw err;
  }
}

async function updateCoupon(id, input) {
  if (!input || Object.keys(input).length === 0) {
    throw new AppError(422, "COUPON_UPDATE_INVALID", "No updatable fields provided");
  }
  const current = await couponsRepository.findCouponById(id);
  if (!current) {
    throw new AppError(404, "COUPON_NOT_FOUND", "Coupon not found");
  }

  const data = {};
  if (input.code !== undefined) {
    const code = normalizeCouponCode(couponCodeSchema.parse(input.code));
    if (code === "") {
      throw new AppError(422, "VALIDATION_ERROR", "Coupon code must not be empty");
    }
    await assertUniqueCode(code, id);
    data.code = code;
  }
  if (input.description !== undefined) {
    data.description = input.description;
  }

  // Discount fields validate against their effective combination, so a
  // partial update (value only) still respects the stored type.
  const effectiveType = input.discountType !== undefined ? input.discountType : current.discountType;
  const currentValue =
    current.discountValue !== null && typeof current.discountValue === "object"
      ? current.discountValue.toFixed(2)
      : String(current.discountValue);
  const effectiveValue =
    input.discountValue !== undefined
      ? normalizeMoneyInput(input.discountValue, "discountValue")
      : currentValue;
  if (input.discountType !== undefined || input.discountValue !== undefined) {
    assertDiscountSemantics(effectiveType, effectiveValue);
    if (input.discountType !== undefined) {
      data.discountType = input.discountType;
    }
    if (input.discountValue !== undefined) {
      data.discountValue = effectiveValue;
    }
  }

  if (input.minimumOrderAmount !== undefined) {
    data.minimumOrderAmount =
      input.minimumOrderAmount === null
        ? null
        : normalizeMoneyInput(input.minimumOrderAmount, "minimumOrderAmount");
  }
  if (input.maximumDiscountAmount !== undefined) {
    data.maximumDiscountAmount =
      input.maximumDiscountAmount === null
        ? null
        : normalizeMoneyInput(input.maximumDiscountAmount, "maximumDiscountAmount");
  }
  if (input.usageLimit !== undefined) {
    data.usageLimit = input.usageLimit;
  }
  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
  }

  // Date fields validate as an effective pair for the same reason.
  const currentStartsAt = current.startsAt ?? null;
  const currentExpiresAt = current.expiresAt ?? null;
  const effectiveStartsAt =
    input.startsAt !== undefined ? parseDateTimeInput(input.startsAt, "startsAt") : currentStartsAt;
  const effectiveExpiresAt =
    input.expiresAt !== undefined ? parseDateTimeInput(input.expiresAt, "expiresAt") : currentExpiresAt;
  if (input.startsAt !== undefined || input.expiresAt !== undefined) {
    assertDateOrder(effectiveStartsAt, effectiveExpiresAt);
    if (input.startsAt !== undefined) {
      data.startsAt = effectiveStartsAt;
    }
    if (input.expiresAt !== undefined) {
      data.expiresAt = effectiveExpiresAt;
    }
  }

  const productIds = await normalizeProductIds(input.productIds);

  try {
    const result = await couponsRepository.updateCouponRecord(id, data, productIds);
    if (result.outcome === "missing") {
      throw new AppError(404, "COUPON_NOT_FOUND", "Coupon not found");
    }
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    if (isCouponCodeConflict(err)) {
      throw new AppError(409, "COUPON_CODE_EXISTS", "A coupon with this code already exists");
    }
    throw err;
  }
  return getCoupon(id);
}

async function deleteCoupon(id) {
  const result = await couponsRepository.deleteCouponRecord(id);
  if (result.outcome === "missing") {
    throw new AppError(404, "COUPON_NOT_FOUND", "Coupon not found");
  }
  if (result.outcome === "in-use") {
    throw new AppError(
      409,
      "COUPON_IN_USE",
      `Coupon has been used ${result.usedCount} time(s) and cannot be deleted. Deactivate it instead.`
    );
  }
  return { id };
}

module.exports = {
  validateCouponForOrder,
  validateCouponForUserCart,
  consumeCouponUsage,
  listCouponsAdmin,
  getCoupon,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  // Pure discount math, exported for unit testing (no DB, no side effects).
  calculateDiscountAmount,
  applyDiscountCap,
};
