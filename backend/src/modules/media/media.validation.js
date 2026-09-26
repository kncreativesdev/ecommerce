const { z } = require("zod");

const booleanFromMultipart = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true")
  .optional();

const uploadMetadataSchema = z
  .object({
    variantId: z.string().trim().min(1).max(36).nullable().optional(),
    altText: z.string().trim().max(255).nullable().optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    isPrimary: booleanFromMultipart,
  })
  .strict();

const updateMetadataSchema = z
  .object({
    variantId: z.string().trim().min(1).max(36).nullable().optional(),
    altText: z.string().trim().max(255).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

module.exports = { uploadMetadataSchema, updateMetadataSchema };
