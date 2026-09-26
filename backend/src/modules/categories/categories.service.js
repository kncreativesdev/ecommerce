const crypto = require("crypto");

const { AppError } = require("../../utils/appError");
const { logger } = require("../../utils/logger");
const categoriesRepository = require("./categories.repository");
const { normalizeSlug, toSafeCategory } = require("./categories.utils");
const { processToWebp, IMAGE_TYPE } = require("../media/imageProcessing");
const { localStorageAdapter } = require("../media/storage/local.storage");

const UPDATABLE_FIELDS = [
  "name",
  "slug",
  "description",
  "image",
  "parentId",
  "isActive",
  "sortOrder",
];

const ANCESTOR_WALK_LIMIT = 100;

function resolveSlug(rawSlug, name) {
  const slug = normalizeSlug(rawSlug !== undefined ? rawSlug : name);
  if (slug === "") {
    throw new AppError(422, "VALIDATION_ERROR", "Slug must contain at least one letter or digit");
  }
  return slug;
}

async function assertParentExists(parentId) {
  const parent = await categoriesRepository.findCategoryById(parentId);
  if (!parent) {
    throw new AppError(404, "CATEGORY_PARENT_NOT_FOUND", "Parent category not found");
  }
  return parent;
}

async function assertNoCycle(categoryId, parentId) {
  let cursorId = parentId;
  for (let depth = 0; depth < ANCESTOR_WALK_LIMIT; depth += 1) {
    if (cursorId === categoryId) {
      throw new AppError(422, "CATEGORY_CYCLE", "Category hierarchy must not contain a cycle");
    }
    const cursor = await categoriesRepository.findCategoryById(cursorId);
    if (!cursor || !cursor.parentId) {
      return;
    }
    cursorId = cursor.parentId;
  }
}

function mapSlugConflict(err) {
  if (err.code === "P2002") {
    throw new AppError(409, "CATEGORY_SLUG_EXISTS", "Category slug already exists");
  }
  throw err;
}

async function listCategories(status = "active") {
  const rows = await categoriesRepository.findCategoriesByStatus(status);
  return rows.map(toSafeCategory);
}

async function getCategory(id, scope = "active") {
  const row =
    scope === "all"
      ? await categoriesRepository.findCategoryById(id)
      : await categoriesRepository.findActiveCategoryById(id);
  if (!row) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }
  return toSafeCategory(row);
}

async function createCategory(input) {
  const slug = resolveSlug(input.slug, input.name);

  if (input.parentId !== undefined && input.parentId !== null) {
    await assertParentExists(input.parentId);
  }

  try {
    const row = await categoriesRepository.createCategory({
      name: input.name,
      slug,
      description: input.description ?? null,
      image: input.image ?? null,
      parentId: input.parentId ?? null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    });
    return toSafeCategory(row);
  } catch (err) {
    mapSlugConflict(err);
  }
}

async function updateCategory(id, input) {
  const existing = await categoriesRepository.findCategoryById(id);
  if (!existing) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }

  const data = {};
  for (const field of UPDATABLE_FIELDS) {
    if (input[field] !== undefined) {
      data[field] = input[field];
    }
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(422, "CATEGORY_UPDATE_INVALID", "No updatable fields provided");
  }

  if (data.slug !== undefined) {
    data.slug = resolveSlug(data.slug, existing.name);
  }

  if (data.parentId !== undefined && data.parentId !== null) {
    if (data.parentId === id) {
      throw new AppError(422, "CATEGORY_SELF_PARENT", "Category cannot be its own parent");
    }
    await assertParentExists(data.parentId);
    await assertNoCycle(id, data.parentId);
  }

  try {
    const row = await categoriesRepository.updateCategory(id, data);
    return toSafeCategory(row);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
    }
    mapSlugConflict(err);
  }
}

async function deactivateCategory(id) {
  const existing = await categoriesRepository.findCategoryById(id);
  if (!existing) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }
  const row = await categoriesRepository.deactivateCategory(id);
  return toSafeCategory(row);
}

/** Storage prefix for files managed by the category image endpoints. */
const MANAGED_IMAGE_PREFIX = "categories/";

function isManagedImage(value) {
  return typeof value === "string" && value.startsWith(MANAGED_IMAGE_PREFIX);
}

/**
 * Category image upload (ADMIN): Sharp/WebP processing shared with product
 * media, stored under `categories/<id>/`, previous managed file removed.
 * The `Category.image` contract stays a ≤500-char string reference — this
 * endpoint is simply its file-backed writer. Works for inactive rows so
 * merchandising can be prepared before reactivation.
 */
async function uploadCategoryImage(id, file) {
  const existing = await categoriesRepository.findCategoryById(id);
  if (!existing) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new AppError(400, "MEDIA_UPLOAD_FAILED", "No image file uploaded");
  }

  const webpBuffer = await processToWebp(file.buffer);
  const filename = `${crypto.randomUUID()}.${IMAGE_TYPE}`;
  const relativeDir = `categories/${id}`;

  let storagePath;
  try {
    storagePath = await localStorageAdapter.save(relativeDir, filename, webpBuffer);
  } catch (err) {
    logger.error({ err: err.message }, "Category image storage write failed");
    throw new AppError(500, "MEDIA_STORAGE_FAILED", "Image storage failed");
  }

  try {
    const row = await categoriesRepository.updateCategory(id, { image: storagePath });
    if (isManagedImage(existing.image) && existing.image !== storagePath) {
      try {
        await localStorageAdapter.remove(existing.image);
      } catch (err) {
        logger.warn("Previous category image cleanup failed after replacement");
      }
    }
    return toSafeCategory(row);
  } catch (err) {
    try {
      await localStorageAdapter.remove(storagePath);
    } catch (cleanupErr) {
      logger.warn("Orphaned category upload cleanup failed after database write failure");
    }
    throw err;
  }
}

/**
 * Category image removal (ADMIN): idempotent — a row with no image returns
 * unchanged. Only files under the managed `categories/` prefix are touched
 * on disk; foreign references are simply unlinked from the record.
 */
async function removeCategoryImage(id) {
  const existing = await categoriesRepository.findCategoryById(id);
  if (!existing) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }
  if (!existing.image) {
    return toSafeCategory(existing);
  }
  const row = await categoriesRepository.updateCategory(id, { image: null });
  if (isManagedImage(existing.image)) {
    try {
      await localStorageAdapter.remove(existing.image);
    } catch (err) {
      logger.warn("Category image file cleanup failed after metadata deletion");
    }
  }
  return toSafeCategory(row);
}

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  deactivateCategory,
  uploadCategoryImage,
  removeCategoryImage,
};
