const { prisma } = require("../../config/database");

const VARIANT_SELECT = {
  id: true,
  productId: true,
  sku: true,
  name: true,
  price: true,
  compareAtPrice: true,
  barcode: true,
  weight: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

const CATEGORY_BRIEF_SELECT = {
  id: true,
  name: true,
  slug: true,
};

function productShape(activeVariantsOnly) {
  const variantSelectWithAvailability = {
    ...VARIANT_SELECT,
    inventory: { select: { quantity: true, reservedQuantity: true } },
  };
  return {
    id: true,
    categoryId: true,
    name: true,
    slug: true,
    description: true,
    shortDescription: true,
    brand: true,
    isActive: true,
    isFeatured: true,
    createdAt: true,
    updatedAt: true,
    category: { select: CATEGORY_BRIEF_SELECT },
    variants: activeVariantsOnly
      ? {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
          select: variantSelectWithAvailability,
        }
      : {
          orderBy: { createdAt: "asc" },
          select: variantSelectWithAvailability,
        },
  };
}

async function findActiveProducts() {
  return prisma.product.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: productShape(true),
  });
}

/**
 * Status-scoped listing for the admin-safe `?status=` filter.
 * `active` → active only with active variants (public default),
 * `inactive` → inactive only, `all` → everything. Non-active scopes embed
 * ALL variants so the admin sees the complete record.
 */
async function findProductsByStatus(status) {
  if (status === "active") {
    return findActiveProducts();
  }
  const where = status === "all" ? {} : { isActive: false };
  return prisma.product.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: productShape(false),
  });
}

async function findActiveProductById(id) {
  return prisma.product.findFirst({
    where: { id, isActive: true },
    select: productShape(true),
  });
}

async function findProductById(id) {
  return prisma.product.findUnique({
    where: { id },
    select: productShape(false),
  });
}

async function createProductWithVariants(productData, variantsData) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: productData,
    });
    for (const variantData of variantsData) {
      await tx.productVariant.create({
        data: { ...variantData, productId: product.id },
      });
    }
    return tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: productShape(false),
    });
  });
}

async function updateProduct(id, data) {
  return prisma.product.update({
    where: { id },
    data,
    select: productShape(false),
  });
}

async function deactivateProduct(id) {
  return prisma.product.update({
    where: { id },
    data: { isActive: false },
    select: productShape(false),
  });
}

async function findVariantByIdAndProductId(variantId, productId) {
  return prisma.productVariant.findFirst({
    where: { id: variantId, productId },
    select: VARIANT_SELECT,
  });
}

async function createVariant(productId, data) {
  return prisma.productVariant.create({
    data: { ...data, productId },
    select: VARIANT_SELECT,
  });
}

async function updateVariant(id, data) {
  return prisma.productVariant.update({
    where: { id },
    data,
    select: VARIANT_SELECT,
  });
}

async function deactivateVariant(id) {
  return prisma.productVariant.update({
    where: { id },
    data: { isActive: false },
    select: VARIANT_SELECT,
  });
}

module.exports = {
  findActiveProducts,
  findProductsByStatus,
  findActiveProductById,
  findProductById,
  createProductWithVariants,
  updateProduct,
  deactivateProduct,
  findVariantByIdAndProductId,
  createVariant,
  updateVariant,
  deactivateVariant,
};
