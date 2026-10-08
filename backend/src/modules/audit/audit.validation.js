const { z } = require("zod");

const { AUDIT_ACTIONS, AUDIT_OUTCOMES, AUDIT_RESOURCES } = require("./audit.service");
const { RETENTION_POLICIES } = require("./retention.service");
const { ROLES } = require("../../config/permissions");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidQuerySchema = z.string().trim().regex(UUID_PATTERN, "Invalid id");

/**
 * GET /audit-logs query contract (Phase 2C-18). Unknown params are
 * stripped (admin-list convention); every accepted filter is typed and
 * validated here, then re-checked in the service. Vocabulary comes
 * from the single audit source of truth — nothing invented.
 *
 * `companyId` accepts a UUID or the literal "null" (SUPER_ADMIN
 * platform-only scope). Non-SUPER_ADMIN callers may send it, but the
 * service ignores it: their scope always comes from the
 * server-resolved company context.
 */
const auditListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    actorId: uuidQuerySchema.optional(),
    resourceId: uuidQuerySchema.optional(),
    companyId: z.union([uuidQuerySchema, z.literal("null")]).optional(),
    resource: z
      .string()
      .trim()
      .refine((value) => AUDIT_RESOURCES.includes(value), "Invalid resource")
      .optional(),
    action: z
      .string()
      .trim()
      .refine((value) => AUDIT_ACTIONS.includes(value), "Invalid action")
      .optional(),
    outcome: z
      .string()
      .trim()
      .refine((value) => AUDIT_OUTCOMES.includes(value), "Invalid outcome")
      .optional(),
    role: z
      .string()
      .trim()
      .refine(
        (value) => [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HEAD, ROLES.MEMBER, ROLES.CUSTOMER].includes(value),
        "Invalid role"
      )
      .optional(),
    from: z.string().trim().min(1).max(100).optional(),
    to: z.string().trim().min(1).max(100).optional(),
  })
  .strip();

/**
 * PATCH /audit-retention body (Phase 2C-19). Strict: only the
 * server-owned enum value is accepted — no companyId, no numeric
 * days/months, no dates, no extra config fields.
 */
const retentionPolicySchema = z
  .object({
    policy: z.enum([...RETENTION_POLICIES]),
  })
  .strict();

/**
 * GET /audit-logs/export query contract (Phase 2C-21). Exactly the
 * read filters minus pagination: export always represents the
 * complete filtered set (bounded server-side), so page/limit are
 * neither accepted nor applied. Unknown params are stripped like
 * the read contract.
 */
const auditExportQuerySchema = z
  .object({
    actorId: uuidQuerySchema.optional(),
    resourceId: uuidQuerySchema.optional(),
    companyId: z.union([uuidQuerySchema, z.literal("null")]).optional(),
    resource: z
      .string()
      .trim()
      .refine((value) => AUDIT_RESOURCES.includes(value), "Invalid resource")
      .optional(),
    action: z
      .string()
      .trim()
      .refine((value) => AUDIT_ACTIONS.includes(value), "Invalid action")
      .optional(),
    outcome: z
      .string()
      .trim()
      .refine((value) => AUDIT_OUTCOMES.includes(value), "Invalid outcome")
      .optional(),
    role: z
      .string()
      .trim()
      .refine(
        (value) => [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HEAD, ROLES.MEMBER, ROLES.CUSTOMER].includes(value),
        "Invalid role"
      )
      .optional(),
    from: z.string().trim().min(1).max(100).optional(),
    to: z.string().trim().min(1).max(100).optional(),
  })
  .strip();

module.exports = { auditListQuerySchema, auditExportQuerySchema, retentionPolicySchema };
