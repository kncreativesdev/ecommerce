const { z } = require("zod");

const emailSchema = z.string().trim().toLowerCase().email().max(255);

const companyIdParamSchema = z
  .object({
    id: z.string().trim().min(1).max(36),
  })
  .strict();

const createCompanySchema = z
  .object({
    name: z.string().trim().min(1, "Company name is required.").max(255),
  })
  .strict();

// Company metadata update (SUPER_ADMIN platform configuration).
// `name` retains its required/non-empty rule when it is the update;
// the nine profile fields below are all optional and nullable, where
// a trimmed empty string means NULL/clear (normalized via preprocess
// so `.email()` never sees ""). `logoPath` is deliberately absent:
// the server stamps it from the dedicated logo upload endpoint only.
// Strict: lifecycle/identity/domain/setting fields are never accepted.
const emptyToNull = (value) => (typeof value === "string" && value.trim() === "" ? null : value);

const updateCompanySchema = z
  .object({
    name: z.string().trim().min(1, "Company name is required.").max(255).optional(),
    contactEmail: z.preprocess(
      emptyToNull,
      z.string().trim().toLowerCase().email().max(255).nullable().optional()
    ),
    contactPhone: z.preprocess(emptyToNull, z.string().trim().max(30).nullable().optional()),
    addressLine1: z.preprocess(emptyToNull, z.string().trim().max(255).nullable().optional()),
    addressLine2: z.preprocess(emptyToNull, z.string().trim().max(255).nullable().optional()),
    city: z.preprocess(emptyToNull, z.string().trim().max(100).nullable().optional()),
    state: z.preprocess(emptyToNull, z.string().trim().max(100).nullable().optional()),
    postalCode: z.preprocess(emptyToNull, z.string().trim().max(20).nullable().optional()),
    country: z.preprocess(emptyToNull, z.string().trim().max(100).nullable().optional()),
    // HTTPS-only website: structural shape here (trim/max), scheme
    // enforcement in the service beside `normalizeHostname` (returns
    // COMPANY_INVALID_WEBSITE, mirroring COMPANY_DOMAIN_INVALID).
    website: z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional()),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.contactEmail !== undefined ||
      input.contactPhone !== undefined ||
      input.addressLine1 !== undefined ||
      input.addressLine2 !== undefined ||
      input.city !== undefined ||
      input.state !== undefined ||
      input.postalCode !== undefined ||
      input.country !== undefined ||
      input.website !== undefined,
    { message: "At least one updatable field is required." }
  );

const companyListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().min(1).max(100).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .strip();

const provisionAdminSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8).max(128),
    firstName: z.string().trim().min(1, "First name is required.").max(100),
    lastName: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().min(1).max(30).optional(),
  })
  .strict();

const resetAdminPasswordSchema = z
  .object({
    password: z.string().min(8).max(128),
  })
  .strict();

const deleteCompanySchema = z
  .object({
    confirmName: z.string().trim().min(1, "Confirmation name is required.").max(255),
  })
  .strict();

// Phase 2C-27 domain registry management. The route company id owns
// the domain — `companyId` is never accepted in the body (strict
// schemas reject it). `domain` is trimmed here; canonicalization and
// hostname validity are enforced server-side in the service through
// the single `normalizeHostname` implementation shared with runtime
// resolution (middleware/companyContext.js).
const companyDomainIdParamSchema = z
  .object({
    id: z.string().trim().min(1).max(36),
    domainId: z.string().trim().min(1).max(36),
  })
  .strict();

const createCompanyDomainSchema = z
  .object({
    domain: z.string().trim().min(1, "Domain is required.").max(255),
  })
  .strict();

const updateCompanyDomainSchema = z
  .object({
    isActive: z.boolean().optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict()
  .refine((input) => input.isActive !== undefined || input.isPrimary !== undefined, {
    message: "At least one of isActive or isPrimary is required.",
  });

// Phase 4-4 Google sign-in allowlist. The route company id owns the
// setting — `companyId` is never accepted in the body (strict schema
// rejects it). `enabled` is a required boolean; no other field exists.
const updateGoogleSignInSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

module.exports = {
  companyIdParamSchema,
  createCompanySchema,
  updateCompanySchema,
  companyListQuerySchema,
  provisionAdminSchema,
  resetAdminPasswordSchema,
  deleteCompanySchema,
  companyDomainIdParamSchema,
  createCompanyDomainSchema,
  updateCompanyDomainSchema,
  updateGoogleSignInSchema,
};
