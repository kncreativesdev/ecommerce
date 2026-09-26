const { z } = require("zod");

const MAX_INT32 = 2147483647;

const initializeSchema = z
  .object({
    quantity: z.number().int().min(0).max(MAX_INT32),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

const adjustSchema = z
  .object({
    quantity: z
      .number()
      .int()
      .refine((n) => n !== 0, { message: "Quantity delta must not be zero" })
      .refine((n) => Math.abs(n) <= MAX_INT32, {
        message: "Quantity delta exceeds the supported range",
      }),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

/**
 * Admin inventory list query. Every field is explicit. `stock` filters
 * on available stock (quantity - reservedQuantity): `in` is strictly
 * positive, `out` is zero/negative OR a missing stock record (a variant
 * with no record cannot be purchased). `active` filters the VARIANT
 * active flag. `search` matches SKU, variant name, or product name.
 * Unknown params are stripped (not rejected).
 */
const adminInventoryListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().min(1).max(100).optional(),
    stock: z.enum(["in", "out"]).optional(),
    active: z.enum(["true", "false"]).optional(),
    sortBy: z.enum(["sku", "createdAt", "updatedAt"]).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  })
  .strip();

const inventoryTransactionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strip();

module.exports = {
  initializeSchema,
  adjustSchema,
  adminInventoryListQuerySchema,
  inventoryTransactionsQuerySchema,
  MAX_INT32,
};
