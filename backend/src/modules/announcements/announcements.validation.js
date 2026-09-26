const { z } = require("zod");

const announcementIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

// Internal destinations only: a shop/category/product route, or no link.
// External URLs and schemes are never accepted.
const linkTargetSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => value.startsWith("/") && !value.startsWith("//"), {
    message: "linkTarget must be an internal route starting with a single /",
  })
  .refine((value) => !/[\s\\]/.test(value) && !/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value), {
    message: "linkTarget must not contain spaces, backslashes, or URL schemes",
  });

const createAnnouncementSchema = z
  .object({
    message: z.string().trim().min(1).max(200),
    isActive: z.boolean().optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    linkLabel: z.string().trim().min(1).max(50).nullable().optional(),
    linkTarget: linkTargetSchema.nullable().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.startsAt && data.expiresAt && data.startsAt > data.expiresAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "expiresAt must be on or after startsAt",
      });
    }
  });

const updateAnnouncementSchema = z
  .object({
    message: z.string().trim().min(1).max(200).optional(),
    isActive: z.boolean().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    linkLabel: z.string().trim().min(1).max(50).nullable().optional(),
    linkTarget: linkTargetSchema.nullable().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

module.exports = {
  announcementIdParamSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
};
