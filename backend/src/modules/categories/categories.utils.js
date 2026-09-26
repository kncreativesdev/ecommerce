function normalizeSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toSafeCategory(category) {
  return {
    id: category.id,
    parentId: category.parentId ?? null,
    name: category.name,
    slug: category.slug,
    description: category.description ?? null,
    image: category.image ?? null,
    isActive: category.isActive,
    sortOrder: category.sortOrder,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

module.exports = { normalizeSlug, toSafeCategory };
