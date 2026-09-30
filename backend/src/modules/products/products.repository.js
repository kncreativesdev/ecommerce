const { prisma } = require("../../config/database");
const { AppError } = require("../../utils/appError");

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

/**
 * Guarded deactivation: eligibility check + state change in ONE database
 * transaction so a concurrent order/status operation cannot invalidate
 * the check between read and write. Throws 404 when the product is
 * missing and 409 PRODUCT_HAS_ACTIVE_ORDERS (with safe blocking-order
 * details, product untouched) when an in-process order still contains
 * the product. Only safe order identifiers (number + status) are read —
 * never customer data. Historical snapshots, inventory, cart, wishlist,
 * reviews, payments, and notifications are never touched here; order
 * status is the source of truth and order items are never mutated.
 */
async function deactivateProductGuarded(id, inProcessStatuses) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true },
    });
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
    }
    if (!product.isActive) {
      return tx.product.findUniqueOrThrow({
        where: { id },
        select: productShape(false),
      });
    }
    const blockingWhere = {
      productId: id,
      order: { status: { in: inProcessStatuses } },
    };
    const [sample, grouped] = await Promise.all([
      tx.orderItem.findMany({
        where: blockingWhere,
        orderBy: { createdAt: "asc" },
        take: 5,
        distinct: ["orderId"],
        select: {
          order: { select: { orderNumber: true, status: true } },
        },
      }),
      tx.orderItem.groupBy({
        by: ["orderId"],
        where: blockingWhere,
      }),
    ]);
    if (grouped.length > 0) {
      const blockingOrders = sample.map((row) => ({
        orderNumber: row.order.orderNumber,
        status: row.order.status,
      }));
      const listed = blockingOrders.map((entry) => `${entry.orderNumber} (${entry.status})`).join(", ");
      throw new AppError(
        409,
        "PRODUCT_HAS_ACTIVE_ORDERS",
        `Cannot deactivate "${product.name}" while it is in ${grouped.length} active order${grouped.length === 1 ? "" : "s"} (${listed}${grouped.length > blockingOrders.length ? ", …" : ""}). Cancel or complete those orders first.`,
        { blockingOrderCount: grouped.length, blockingOrders }
      );
    }
    return tx.product.update({
      where: { id },
      data: { isActive: false },
      select: productShape(false),
    });
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
  deactivateProductGuarded,
  findVariantByIdAndProductId,
  createVariant,
  updateVariant,
  deactivateVariant,
};
