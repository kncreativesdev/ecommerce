const { prisma } = require("../../config/database");
const { AppError } = require("../../utils/appError");
const auditRepository = require("../audit/audit.repository");

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
  // Tenant ownership for Phase 2C-1 catalog/cart/checkout enforcement.
  // Selected, never serialized (safe mappers pick explicit fields).
  companyId: true,
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
    companyId: true,
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

/**
 * Phase 2C-4 company scoping: `companyId` null means unscoped (public
 * catalog reads pass null and behave exactly as before); non-null
 * restricts to the company. These list/detail queries contain no OR
 * search conditions, so the predicate can never be escaped by filter
 * logic.
 */
async function findActiveProducts(companyId = null) {
  return prisma.product.findMany({
    where: { isActive: true, ...(companyId ? { companyId } : {}) },
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
async function findProductsByStatus(status, companyId = null) {
  if (status === "active") {
    return findActiveProducts(companyId);
  }
  const where = status === "all" ? {} : { isActive: false };
  return prisma.product.findMany({
    where: { ...where, ...(companyId ? { companyId } : {}) },
    orderBy: { createdAt: "asc" },
    select: productShape(false),
  });
}

async function findActiveProductById(id, companyId = null) {
  return prisma.product.findFirst({
    where: { id, isActive: true, ...(companyId ? { companyId } : {}) },
    select: productShape(true),
  });
}

async function findProductById(id, companyId = null) {
  return prisma.product.findFirst({
    where: { id, ...(companyId ? { companyId } : {}) },
    select: productShape(false),
  });
}

async function createProductWithVariants(productData, variantsData, audit = null) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: productData,
    });
    for (const variantData of variantsData) {
      await tx.productVariant.create({
        data: { ...variantData, productId: product.id },
      });
    }
    // Phase 2C-17: the pre-validated creation audit commits with the
    // rows it describes — the repository stamps the created id.
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: product.id }, tx);
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
async function deactivateProductGuarded(id, companyId, inProcessStatuses, audit = null) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true, companyId: true },
    });
    // Same-transaction company gate: a cross-company product reads as
    // missing, so the eligibility check and the state change below can
    // never diverge across companies.
    if (!product || product.companyId !== companyId) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
    }
    if (!product.isActive) {
      return {
        row: await tx.product.findUniqueOrThrow({
          where: { id },
          select: productShape(false),
        }),
        // No transition happened (raced deactivation): the caller must
        // not record a DEACTIVATED audit for a no-op.
        transitioned: false,
      };
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
    const row = await tx.product.update({
      where: { id },
      data: { isActive: false },
      select: productShape(false),
    });
    // Phase 2C-17: the pre-validated deactivation audit commits with
    // the transition it describes.
    if (audit) {
      await auditRepository.createAuditEvent({ ...audit, resourceId: row.id }, tx);
    }
    return { row, transitioned: true };
  });
}

async function findVariantByIdAndProductId(variantId, productId, companyId = null) {
  return prisma.productVariant.findFirst({
    where: { id: variantId, productId, ...(companyId ? { companyId } : {}) },
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
