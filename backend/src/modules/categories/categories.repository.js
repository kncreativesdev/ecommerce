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
  createdAt: true,
  updatedAt: true,
};

async function findActiveCategories() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: CATEGORY_SELECT,
  });
}

/**
 * Status-scoped listing for the admin-safe `?status=` filter.
 * `active` → active only (public default), `inactive` → inactive only,
 * `all` → everything. Ordering matches the public list.
 */
async function findCategoriesByStatus(status) {
  const where = status === "all" ? {} : { isActive: status !== "inactive" };
  return prisma.category.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: CATEGORY_SELECT,
  });
}

async function findActiveCategoryById(id) {
  return prisma.category.findFirst({
    where: { id, isActive: true },
    select: CATEGORY_SELECT,
  });
}

async function findCategoryById(id) {
  return prisma.category.findUnique({
    where: { id },
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
