const { z } = require("zod");

function normalizeCouponCode(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value.trim().toUpperCase();
}

const couponCodeSchema = z.string().trim().min(1).max(50);

const moneyStringSchema = z.string().regex(/^\d+\.\d{2}$/, {
  message: "Amount must be a decimal string with two fraction digits",
});

const couponOrderLineSchema = z
  .object({
    productId: z.string().uuid(),
    lineTotal: moneyStringSchema,
  })
  .strict();

const couponOrderLinesSchema = z.array(couponOrderLineSchema).min(1);

const discountTypeSchema = z.enum(["PERCENTAGE", "FIXED"]);

// Money accepted as decimal strings or numbers (products convention);
// range/shape normalization happens in the service layer.
const moneyInputSchema = z.union([z.string(), z.number()]);

const nullableMoneyInputSchema = moneyInputSchema.nullable().optional();

const nullableDateTimeInputSchema = z.string().trim().min(1).max(40).nullable().optional();

const productIdsInputSchema = z.array(z.string().uuid()).optional();

const couponBaseFields = {
  description: z.string().trim().max(500).nullable().optional(),
  discountType: discountTypeSchema,
  discountValue: moneyInputSchema,
  minimumOrderAmount: nullableMoneyInputSchema,
  maximumDiscountAmount: nullableMoneyInputSchema,
  usageLimit: z.number().int().min(1).max(2147483647).nullable().optional(),
  startsAt: nullableDateTimeInputSchema,
  expiresAt: nullableDateTimeInputSchema,
  isActive: z.boolean().optional(),
  productIds: productIdsInputSchema,
};

const createCouponSchema = z.object({ code: couponCodeSchema, ...couponBaseFields }).strict();

const updateCouponSchema = z
  .object({
    code: couponCodeSchema.optional(),
    description: couponBaseFields.description,
    discountType: discountTypeSchema.optional(),
    discountValue: moneyInputSchema.optional(),
    minimumOrderAmount: nullableMoneyInputSchema,
    maximumDiscountAmount: nullableMoneyInputSchema,
    usageLimit: couponBaseFields.usageLimit,
    startsAt: nullableDateTimeInputSchema,
    expiresAt: nullableDateTimeInputSchema,
    isActive: z.boolean().optional(),
    productIds: productIdsInputSchema,
  })
  .strict();

const couponIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

/** Customer validate request: code only — lines always come from the caller's cart. */
const validateCouponRequestSchema = z
  .object({
    code: couponCodeSchema,
  })
  .strict();

/**
 * Admin list query. Explicit allowlist only (API.md §9). Unknown params
 * are stripped so links/caches never 422 the list.
 */
const adminCouponListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(["active", "inactive", "all"]).optional(),
    search: z.string().trim().min(1).max(100).optional(),
  })
  .strip();

module.exports = {
  normalizeCouponCode,
  couponCodeSchema,
  couponOrderLineSchema,
  couponOrderLinesSchema,
  moneyStringSchema,
  discountTypeSchema,
  createCouponSchema,
  updateCouponSchema,
  couponIdParamSchema,
  validateCouponRequestSchema,
  adminCouponListQuerySchema,
};
