const { z } = require("zod");

const createCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    slug: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().nullable().optional(),
    image: z.string().trim().min(1).max(500).nullable().optional(),
    parentId: z.string().trim().min(1).max(36).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();

const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    slug: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().nullable().optional(),
    image: z.string().trim().min(1).max(500).nullable().optional(),
    parentId: z.string().trim().min(1).max(36).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();

module.exports = { createCategorySchema, updateCategorySchema };
