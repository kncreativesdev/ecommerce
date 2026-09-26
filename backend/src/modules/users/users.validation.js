const { z } = require("zod");

const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).nullable().optional(),
    lastName: z.string().trim().min(1).max(100).nullable().optional(),
    phone: z.string().trim().min(1).max(30).nullable().optional(),
  })
  .strict();

const userIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

/**
 * Admin user list query. Every field is explicit (API.md §9: never
 * convert arbitrary query params into DB queries). `isActive` arrives as
 * a query string, so it is an explicit "true"/"false" enum (never
 * `z.coerce.boolean()`, which maps "false" to true). Unknown params are
 * stripped (not rejected) so pagination links never 422 the list.
 */
const adminUserListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().min(1).max(100).optional(),
    isActive: z.enum(["true", "false"]).optional(),
    sortBy: z.enum(["createdAt"]).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  })
  .strip();

const updateUserActiveSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

module.exports = {
  updateProfileSchema,
  userIdParamSchema,
  adminUserListQuerySchema,
  updateUserActiveSchema,
};
