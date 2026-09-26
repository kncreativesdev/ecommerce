const { z } = require("zod");

const { couponCodeSchema } = require("../coupons/coupons.validation");

const createOrderSchema = z
  .object({
    shippingAddressId: z.string().uuid(),
    billingAddressId: z.string().uuid().optional(),
    // Optional coupon code (normalized server-side). Pricing stays
    // server-authoritative: the backend validates, discounts, totals, and
    // consumes usage — the client never sends amounts.
    couponCode: couponCodeSchema.optional(),
  })
  .strict();

const orderIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

const orderStatusSchema = z.enum([
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DISPATCHED",
  "IN_TRANSIT",
  "ARRIVED_IN_CITY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
]);

const paymentStatusSchema = z.enum(["PENDING", "PAID", "FAILED", "REFUNDED"]);

/**
 * Admin order list query. Every field is explicit (API.md §9: never
 * convert arbitrary query params into DB queries). All fields optional;
 * unknown params are stripped (not rejected) so pagination links and
 * caches never 422 the list.
 */
const adminOrderListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: orderStatusSchema.optional(),
    paymentStatus: paymentStatusSchema.optional(),
    search: z.string().trim().min(1).max(100).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    state: z.string().trim().min(1).max(100).optional(),
    from: z.string().trim().min(1).max(40).optional(),
    to: z.string().trim().min(1).max(40).optional(),
    sortBy: z.enum(["createdAt", "grandTotal"]).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  })
  .strip();

const updateOrderStatusSchema = z
  .object({
    status: orderStatusSchema,
    // Optional operational note stored on the history row (e.g.
    // "Handed to courier"). Trimmed; empty string is treated as absent.
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const updatePaymentStatusSchema = z
  .object({
    status: paymentStatusSchema,
  })
  .strict();

const bulkUpdateOrderStatusSchema = z
  .object({
    orderIds: z.array(z.string().uuid()).min(1).max(100),
    status: orderStatusSchema,
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

module.exports = {
  createOrderSchema,
  orderIdParamSchema,
  orderStatusSchema,
  paymentStatusSchema,
  adminOrderListQuerySchema,
  updateOrderStatusSchema,
  updatePaymentStatusSchema,
  bulkUpdateOrderStatusSchema,
};
