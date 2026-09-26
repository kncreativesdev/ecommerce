const { z } = require("zod");

const marketingTypeSchema = z.enum(["DEAL", "OFFER", "ANNOUNCEMENT"]);
const linkTypeSchema = z.enum(["SHOP", "CATEGORY", "PRODUCT", "COUPON"]);

const marketingIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

function dateRangeRefine(data, ctx) {
  if (data.startsAt && data.expiresAt && data.startsAt > data.expiresAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "expiresAt must be on or after startsAt",
    });
  }
}

const createMarketingSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    message: z.string().trim().min(1).max(1000),
    type: marketingTypeSchema.optional(),
    isActive: z.boolean().optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    linkType: linkTypeSchema.nullable().optional(),
    linkValue: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict()
  .superRefine(dateRangeRefine)
  .refine(
    (data) => (data.linkType ? Boolean(data.linkValue) : true),
    { path: ["linkValue"], message: "linkValue is required when linkType is set" }
  );

const updateMarketingSchema = z
  .object({
    title: z.string().trim().min(1).max(150).optional(),
    message: z.string().trim().min(1).max(1000).optional(),
    type: marketingTypeSchema.optional(),
    isActive: z.boolean().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    linkType: linkTypeSchema.nullable().optional(),
    linkValue: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  })
  .refine(
    (data) => (data.linkType ? data.linkValue !== null && data.linkValue !== undefined : true),
    { path: ["linkValue"], message: "linkValue is required when linkType is set" }
  );

module.exports = {
  marketingIdParamSchema,
  createMarketingSchema,
  updateMarketingSchema,
  marketingTypeSchema,
};
