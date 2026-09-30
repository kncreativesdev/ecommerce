const { z } = require("zod");

const returnReasonSchema = z.enum([
  "WRONG_COLOR",
  "WRONG_SIZE",
  "DAMAGED",
  "DEFECTIVE",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "CHANGED_MIND",
  "OTHER",
]);

const orderIdParamSchema = z
  .object({
    orderId: z.string().uuid(),
  })
  .strict();

/**
 * Customer return-request body: reason + details only. Ownership, order,
 * status, and timestamps are derived server-side — `userId`/`orderId` in
 * the body are rejected by `.strict()`. `OTHER` requires details; other
 * reasons keep details optional (blank details normalize to null downstream).
 */
const createReturnSchema = z
  .object({
    reason: returnReasonSchema,
    details: z.string().trim().max(1000, "Details must be at most 1000 characters.").nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reason === "OTHER" && !value.details?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["details"],
        message: "Details are required when the reason is Other.",
      });
    }
  });

const returnStatusSchema = z.enum(["REQUESTED", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"]);

const returnIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

/**
 * Admin list query. Explicit allowlist only (same convention as the admin
 * order list). Unknown params are stripped so links/caches never 422.
 * Only filters reliably backed by the return query are exposed: return
 * status plus a search over order number and customer identity.
 */
const adminReturnListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: returnStatusSchema.optional(),
    search: z.string().trim().min(1).max(100).optional(),
  })
  .strip();

module.exports = {
  returnReasonSchema,
  returnStatusSchema,
  orderIdParamSchema,
  returnIdParamSchema,
  createReturnSchema,
  adminReturnListQuerySchema,
};
