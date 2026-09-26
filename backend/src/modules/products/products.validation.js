const { z } = require("zod");

const priceInput = z.union([z.string(), z.number()]);

const variantFields = {
  sku: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(150),
  price: priceInput,
  compareAtPrice: priceInput.nullable().optional(),
  barcode: z.string().trim().min(1).max(100).nullable().optional(),
  weight: priceInput.nullable().optional(),
  isActive: z.boolean().optional(),
};

const createVariantSchema = z.object(variantFields).strict();

const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    slug: z.string().trim().min(1).max(280).optional(),
    description: z.string().trim().nullable().optional(),
    shortDescription: z.string().trim().nullable().optional(),
    brand: z.string().trim().min(1).max(100).nullable().optional(),
    categoryId: z.string().trim().min(1).max(36),
    isActive: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    variants: z.array(createVariantSchema).optional(),
  })
  .strict();

const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    slug: z.string().trim().min(1).max(280).optional(),
    description: z.string().trim().nullable().optional(),
    shortDescription: z.string().trim().nullable().optional(),
    brand: z.string().trim().min(1).max(100).nullable().optional(),
    categoryId: z.string().trim().min(1).max(36).optional(),
    isActive: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
  })
  .strict();

const updateVariantSchema = z
  .object({
    name: variantFields.name.optional(),
    sku: variantFields.sku.optional(),
    price: variantFields.price.optional(),
    compareAtPrice: variantFields.compareAtPrice,
    barcode: variantFields.barcode,
    weight: variantFields.weight,
    isActive: variantFields.isActive,
  })
  .strict();

module.exports = {
  createProductSchema,
  updateProductSchema,
  createVariantSchema,
  updateVariantSchema,
};
