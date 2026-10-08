const { prisma } = require("../../config/database");

const CATEGORY_SELECT = {
  id: true,
  parentId: true,
  name: true,
  slug: true,
  description: true,
  image: true,
  isActive: true,
  sortOrder: true,
  // Tenant ownership for Phase 2C-1 catalog stamping/graft checks.
  // Selected, never serialized (toSafeCategory picks explicit fields).
  companyId: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Phase 2C-4 company scoping: `companyId` null means unscoped (public
 * catalog reads pass null and behave exactly as before); non-null
 * restricts to the company. There are no OR search conditions in these
 * queries, so the predicate can never be escaped by filter logic.
 */
async function findActiveCategories(companyId = null) {
  return prisma.category.findMany({
    where: { isActive: true, ...(companyId ? { companyId } : {}) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: CATEGORY_SELECT,
  });
}

/**
 * Status-scoped listing for the admin-safe `?status=` filter.
 * `active` → active only (public default), `inactive` → inactive only,
 * `all` → everything. Ordering matches the public list.
 */
async function findCategoriesByStatus(status, companyId = null) {
  const where = status === "all" ? {} : { isActive: status !== "inactive" };
  return prisma.category.findMany({
    where: { ...where, ...(companyId ? { companyId } : {}) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: CATEGORY_SELECT,
  });
}

async function findActiveCategoryById(id, companyId = null) {
  return prisma.category.findFirst({
    where: { id, isActive: true, ...(companyId ? { companyId } : {}) },
    select: CATEGORY_SELECT,
  });
}

async function findCategoryById(id, companyId = null) {
  return prisma.category.findFirst({
    where: { id, ...(companyId ? { companyId } : {}) },
    select: CATEGORY_SELECT,
  });
}

async function createCategory(data) {
  return prisma.category.create({
    data,
    select: CATEGORY_SELECT,
  });
}

async function updateCategory(id, data) {
  return prisma.category.update({
    where: { id },
    data,
    select: CATEGORY_SELECT,
  });
}

async function deactivateCategory(id) {
  return prisma.category.update({
    where: { id },
    data: { isActive: false },
    select: CATEGORY_SELECT,
  });
}

module.exports = {
  findActiveCategories,
  findCategoriesByStatus,
  findActiveCategoryById,
  findCategoryById,
  createCategory,
  updateCategory,
  deactivateCategory,
};
