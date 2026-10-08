const crypto = require("crypto");

const { AppError } = require("../../utils/appError");
const { logger } = require("../../utils/logger");
const categoriesRepository = require("./categories.repository");
const { normalizeSlug, toSafeCategory } = require("./categories.utils");
const { processToWebp, IMAGE_TYPE } = require("../media/imageProcessing");
const { localStorageAdapter } = require("../media/storage/local.storage");
const { resolveActorSnapshot, recordAuditEvent } = require("../audit/audit.service");

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

/**
 * Phase 2C-1 graft check: a parent must exist AND belong to the same
 * company. Cross-company parents fail with the same 404 as missing
 * ones — no existence oracle.
 */
async function assertParentExists(parentId, companyId) {
  const parent = await categoriesRepository.findCategoryById(parentId);
  if (!parent || parent.companyId !== companyId) {
    throw new AppError(404, "CATEGORY_PARENT_NOT_FOUND", "Parent category not found");
  }
  return parent;
}

function assertCreatorCompany(companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  return companyId;
}

/**
 * Phase 3-1 RBAC: active-state writes need an explicit grant. ADMIN and
 * HEAD hold category:DEACTIVATE; MEMBER holds CREATE/READ/UPDATE only,
 * so a MEMBER caller may never submit `isActive` (neither deactivating
 * nor self-approving an inactive row). The HTTP controller always
 * supplies `actor.roles`; a missing roles array fails closed.
 */
function assertMayWriteActiveState(actor, field = "isActive") {
  const roles = actor && Array.isArray(actor.roles) ? actor.roles : [];
  if (roles.includes("ADMIN") || roles.includes("HEAD")) {
    return;
  }
  throw new AppError(403, "AUTH_FORBIDDEN", `Insufficient permissions to set ${field}`);
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

/**
 * Phase 2C-17 mutation audit (post-commit pattern for single-write
 * catalog operations — no transaction exists to join; the event is
 * recorded only after the mutation succeeds, so a failed mutation can
 * never leave a false success record). Actor snapshots resolve from
 * the server-side caller id the controller passes, never request data.
 */
async function snapshotActor(actor) {
  return actor && actor.id ? resolveActorSnapshot(actor.id) : null;
}

function mutationEvent(snapshot, { companyId, action, resourceId, details }) {
  return {
    actorId: snapshot ? snapshot.id : null,
    actorRole: snapshot ? snapshot.role : "SYSTEM",
    actorEmail: snapshot ? snapshot.email : null,
    companyId,
    action,
    resource: "CATEGORY",
    resourceId,
    outcome: "SUCCESS",
    details: details ?? null,
  };
}

function mapSlugConflict(err) {
  // Since Phase 2C-10 the conflicting key is (companyId, slug): same
  // code, now per-company. Cross-company reuse never conflicts.
  if (err.code === "P2002") {
    throw new AppError(409, "CATEGORY_SLUG_EXISTS", "Category slug already exists");
  }
  throw err;
}

/**
 * Phase 2C-12 public storefront rule: company-owned catalog reads
 * require a resolved company. Public requests without one (unknown
 * host) fail closed with the existing not-found code — no catalog
 * data, no existence oracle beyond the 404 itself. This does not
 * affect non-storefront callers: every current caller passes the
 * request's resolved company (possibly null).
 */
function assertPublicCompany(companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }
  return companyId;
}

async function listCategories(status = "active", companyId = null) {
  assertPublicCompany(companyId);
  const rows = await categoriesRepository.findCategoriesByStatus(status, companyId);
  return rows.map(toSafeCategory);
}

async function getCategory(id, scope = "active", companyId = null) {
  assertPublicCompany(companyId);
  const row =
    scope === "all"
      ? await categoriesRepository.findCategoryById(id, companyId)
      : await categoriesRepository.findActiveCategoryById(id, companyId);
  if (!row) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }
  return toSafeCategory(row);
}

async function createCategory(companyId, input, actor = null) {
  assertCreatorCompany(companyId);
  // Phase 3-1: creating an inactive row is an active-state write, not
  // part of plain CREATE. The default (omitted → active) is unaffected.
  if (input.isActive === false) {
    assertMayWriteActiveState(actor);
  }
  const slug = resolveSlug(input.slug, input.name);

  if (input.parentId !== undefined && input.parentId !== null) {
    await assertParentExists(input.parentId, companyId);
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
      // Stamped from the creator's server-resolved company (Phase 2C-1).
      companyId,
    });
    await recordAuditEvent(
      mutationEvent(await snapshotActor(actor), {
        companyId,
        action: "CREATED",
        resourceId: row.id,
        details: { name: row.name },
      })
    );
    return toSafeCategory(row);
  } catch (err) {
    mapSlugConflict(err);
  }
}

async function updateCategory(id, companyId, input, actor = null) {
  assertCreatorCompany(companyId);
  const existing = await categoriesRepository.findCategoryById(id, companyId);
  if (!existing) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }

  const data = {};
  for (const field of UPDATABLE_FIELDS) {
    if (input[field] !== undefined) {
      data[field] = input[field];
    }
  }

  // Phase 3-1: any explicit `isActive` on PATCH is an active-state
  // write (flip or re-affirmation alike), reserved to ADMIN/HEAD.
  if (data.isActive !== undefined) {
    assertMayWriteActiveState(actor);
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
    await assertParentExists(data.parentId, existing.companyId);
    await assertNoCycle(id, data.parentId);
  }

  try {
    const row = await categoriesRepository.updateCategory(id, data);
    // An isActive flip classifies the event (coupon convention); any
    // other change is UPDATED.
    const flipped = data.isActive !== undefined && data.isActive !== existing.isActive;
    await recordAuditEvent(
      mutationEvent(await snapshotActor(actor), {
        companyId,
        action: flipped ? (data.isActive ? "REACTIVATED" : "DEACTIVATED") : "UPDATED",
        resourceId: row.id,
        details: { name: row.name },
      })
    );
    return toSafeCategory(row);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
    }
    mapSlugConflict(err);
  }
}

async function deactivateCategory(id, companyId, actor = null) {
  assertCreatorCompany(companyId);
  const existing = await categoriesRepository.findCategoryById(id, companyId);
  if (!existing) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }
  const row = await categoriesRepository.deactivateCategory(id);
  await recordAuditEvent(
    mutationEvent(await snapshotActor(actor), {
      companyId,
      action: "DEACTIVATED",
      resourceId: row.id,
      details: { name: row.name },
    })
  );
  return toSafeCategory(row);
}

/** Storage prefix for files managed by the category image endpoints. */
const MANAGED_IMAGE_PREFIX = "categories/";

function isManagedImage(value) {
  return typeof value === "string" && value.startsWith(MANAGED_IMAGE_PREFIX);
}

/**
 * Category image upload (ADMIN/HEAD/MEMBER — a category UPDATE writing
 * the `image` field): Sharp/WebP processing shared with product
 * media, stored under `categories/<id>/`, previous managed file removed.
 * The `Category.image` contract stays a ≤500-char string reference — this
 * endpoint is simply its file-backed writer. Works for inactive rows so
 * merchandising can be prepared before reactivation.
 */
async function uploadCategoryImage(id, companyId, file, actor = null) {
  assertCreatorCompany(companyId);
  const existing = await categoriesRepository.findCategoryById(id, companyId);
  if (!existing) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new AppError(400, "MEDIA_UPLOAD_FAILED", "No image file uploaded");
  }

  const webpBuffer = await processToWebp(file.buffer);
  const filename = `${crypto.randomUUID()}.${IMAGE_TYPE}`;
  // Phase 2C-9 company-prefixed storage (same contract as product
  // media): server-derived company subtree, legacy fallback for
  // unstamped rows.
  const relativeDir =
    existing.companyId && existing.companyId === companyId
      ? `companies/${companyId}/categories/${id}`
      : `categories/${id}`;

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
    await recordAuditEvent(
      mutationEvent(await snapshotActor(actor), {
        companyId,
        action: "UPDATED",
        resourceId: row.id,
        details: { name: row.name, imageOperation: "uploaded" },
      })
    );
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
 * Category image removal (ADMIN/HEAD/MEMBER — same UPDATE mapping as
 * upload): idempotent — a row with no image returns
 * unchanged. Only files under the managed `categories/` prefix are touched
 * on disk; foreign references are simply unlinked from the record.
 */
async function removeCategoryImage(id, companyId, actor = null) {
  assertCreatorCompany(companyId);
  const existing = await categoriesRepository.findCategoryById(id, companyId);
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
  await recordAuditEvent(
    mutationEvent(await snapshotActor(actor), {
      companyId,
      action: "UPDATED",
      resourceId: row.id,
      details: { name: row.name, imageOperation: "removed" },
    })
  );
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
