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

/**
 * Phase 2C-31 HEAD/MEMBER management contracts. The route company id
 * owns every operation — `companyId` is never accepted in the body
 * (strict schemas reject it), and manageable roles are allowlisted
 * (role escalation to ADMIN/HEAD/SUPER_ADMIN/CUSTOMER is rejected
 * outright, never coerced). Email/password/name/phone conventions
 * mirror the provisioning primitive (`provisionEmployee`).
 */
const createEmployeeSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(8).max(128),
    firstName: z.string().trim().min(1, "First name is required.").max(100),
    lastName: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().min(1).max(30).optional(),
    role: z.enum(["HEAD", "MEMBER"]),
  })
  .strict();

/**
 * Manager-driven MEMBER profile update. Identity fields stay out by
 * design: no `email` (deferred §AK.9), no `password` (dedicated
 * flows only), no `role`/`companyId`/`isActive` (provisioning and
 * lifecycle endpoints own those). Nullable semantics mirror the
 * self-service `updateProfileSchema`; emptiness is rejected by the
 * service with `USER_UPDATE_INVALID` like the self path.
 */
const updateMemberProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).nullable().optional(),
    lastName: z.string().trim().min(1).max(100).nullable().optional(),
    phone: z.string().trim().min(1).max(30).nullable().optional(),
  })
  .strict();

module.exports = {
  updateProfileSchema,
  userIdParamSchema,
  adminUserListQuerySchema,
  updateUserActiveSchema,
  createEmployeeSchema,
  updateMemberProfileSchema,
};
