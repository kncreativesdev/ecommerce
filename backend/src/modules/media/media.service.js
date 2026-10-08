const crypto = require("crypto");

const { AppError } = require("../../utils/appError");
const { logger } = require("../../utils/logger");
const { prisma } = require("../../config/database");
const mediaRepository = require("./media.repository");
const { findProductById, findVariantByIdAndProductId } = require("../products/products.repository");
const { localStorageAdapter } = require("./storage/local.storage");
const { processToWebp, IMAGE_TYPE } = require("./imageProcessing");
const { toSafeImage } = require("./media.utils");
const { resolveActorSnapshot, assertAuditInput, recordAuditEvent } = require("../audit/audit.service");
const auditRepository = require("../audit/audit.repository");

const UPDATABLE_METADATA_FIELDS = ["variantId", "altText", "sortOrder", "isPrimary"];

/**
 * Phase 2C-4 product gate for media operations. `companyId` null means
 * unscoped (public reads pass null and behave exactly as before);
 * non-null requires the product's company to match, so cross-company
 * products fail exactly like missing ones.
 */
async function assertProduct(productId, activeOnly, companyId = null) {
  const product = await findProductById(productId, companyId);
  if (!product || (activeOnly && !product.isActive)) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  return product;
}

async function assertVariant(productId, variantId, companyId = null) {
  const variant = await findVariantByIdAndProductId(variantId, productId, companyId);
  if (!variant) {
    throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
  }
  return variant;
}

/**
 * Phase 2C-17 image audit. Image rows carry no company of their own —
 * the event attaches to the owning PRODUCT (resourceId = product id)
 * with the image id in safe metadata. The payload is validated up
 * front; multi-write paths commit it in-transaction, single writes
 * record post-commit.
 */
async function snapshotActor(actor) {
  return actor && actor.id ? resolveActorSnapshot(actor.id) : null;
}

function imageEvent(snapshot, companyId, productId, operation, imageId) {
  return assertAuditInput({
    actorId: snapshot ? snapshot.id : null,
    actorRole: snapshot ? snapshot.role : "SYSTEM",
    actorEmail: snapshot ? snapshot.email : null,
    companyId,
    action: "UPDATED",
    resource: "PRODUCT",
    resourceId: productId,
    outcome: "SUCCESS",
    details: { imageOperation: operation, imageId },
  });
}

/**
 * Phase 2C-12 public storefront rule: image reads are product-keyed,
 * so they inherit the product gate — including the fail-closed
 * behavior when no company resolved (unknown host → no product data).
 */
async function listImages(productId, companyId = null) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  await assertProduct(productId, true, companyId);
  const rows = await mediaRepository.findImagesByProduct(productId);
  return rows.map(toSafeImage);
}

async function getImage(productId, imageId, companyId = null) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  await assertProduct(productId, true, companyId);
  const row = await mediaRepository.findImageByIdAndProductId(imageId, productId);
  if (!row) {
    throw new AppError(404, "MEDIA_NOT_FOUND", "Image not found");
  }
  return toSafeImage(row);
}

async function uploadImage(productId, companyId, file, meta, actor = null) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  const product = await assertProduct(productId, false, companyId);
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new AppError(400, "MEDIA_UPLOAD_FAILED", "No image file uploaded");
  }
  if (meta.variantId !== undefined && meta.variantId !== null) {
    await assertVariant(productId, meta.variantId, companyId);
  }

  const webpBuffer = await processToWebp(file.buffer);
  const filename = `${crypto.randomUUID()}.webp`;
  // Phase 2C-9 company-prefixed storage: new files land under the
  // product's authoritative company so a company subtree can be listed
  // or reclaimed without touching other tenants. Both segments are
  // server-derived (never request input); the filename stays a random
  // UUID. Unstamped legacy products keep the historical layout so
  // their merchandising never breaks.
  const relativeDir =
    product.companyId && product.companyId === companyId
      ? `companies/${companyId}/products/${productId}`
      : `products/${productId}`;

  let storagePath;
  try {
    storagePath = await localStorageAdapter.save(relativeDir, filename, webpBuffer);
  } catch (err) {
    logger.error({ err: err.message }, "Media storage write failed");
    throw new AppError(500, "MEDIA_STORAGE_FAILED", "Image storage failed");
  }

  try {
    const wantPrimary = meta.isPrimary === true;
    const snapshot = await snapshotActor(actor);
    if (!wantPrimary) {
      const row = await mediaRepository.createImage({
        productId,
        variantId: meta.variantId ?? null,
        filename,
        storagePath,
        imageType: IMAGE_TYPE,
        altText: meta.altText ?? null,
        sortOrder: meta.sortOrder ?? 0,
        isPrimary: false,
      });
      await recordAuditEvent(imageEvent(snapshot, companyId, productId, "added", row.id));
      return toSafeImage(row);
    }
    // Product-level single-primary invariant: demoting siblings and
    // creating the new primary must be atomic so concurrent uploads or a
    // mid-flight failure can never leave two primaries behind.
    const audit = imageEvent(snapshot, companyId, productId, "added-primary", null);
    const row = await prisma.$transaction(async (tx) => {
      await mediaRepository.demoteOtherImages(productId, null, tx);
      const created = await mediaRepository.createImage(
        {
          productId,
          variantId: meta.variantId ?? null,
          filename,
          storagePath,
          imageType: IMAGE_TYPE,
          altText: meta.altText ?? null,
          sortOrder: meta.sortOrder ?? 0,
          isPrimary: true,
        },
        tx
      );
      await auditRepository.createAuditEvent({ ...audit, details: { imageOperation: "added-primary", imageId: created.id } }, tx);
      return created;
    });
    return toSafeImage(row);
  } catch (err) {
    try {
      await localStorageAdapter.remove(storagePath);
    } catch (cleanupErr) {
      logger.warn("Orphaned upload cleanup failed after database write failure");
    }
    throw err;
  }
}

async function updateImageMetadata(productId, companyId, imageId, input, actor = null) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  await assertProduct(productId, false, companyId);
  const existing = await mediaRepository.findImageByIdAndProductId(imageId, productId);
  if (!existing) {
    throw new AppError(404, "MEDIA_NOT_FOUND", "Image not found");
  }

  const data = {};
  for (const field of UPDATABLE_METADATA_FIELDS) {
    if (input[field] !== undefined) {
      data[field] = input[field];
    }
  }
  if (Object.keys(data).length === 0) {
    throw new AppError(422, "MEDIA_UPDATE_INVALID", "No updatable fields provided");
  }

  if (data.variantId !== undefined && data.variantId !== null) {
    await assertVariant(productId, data.variantId, companyId);
  }

  try {
    // Product-level single-primary invariant: setting one image primary
    // must demote every other image of the same product atomically.
    // Reads/writes for other products are never touched; the pre-check
    // above (findImageByIdAndProductId) already rejects mismatched
    // product/image ids with 404 before any write occurs.
    const snapshot = await snapshotActor(actor);
    const audit = imageEvent(
      snapshot,
      companyId,
      productId,
      data.isPrimary === true ? "promoted-primary" : "metadata",
      existing.id
    );
    if (data.isPrimary === true) {
      const row = await prisma.$transaction(async (tx) => {
        await mediaRepository.demoteOtherImages(productId, existing.id, tx);
        const updated = await mediaRepository.updateImage(existing.id, data, tx);
        await auditRepository.createAuditEvent(audit, tx);
        return updated;
      });
      return toSafeImage(row);
    }
    const row = await mediaRepository.updateImage(existing.id, data);
    await recordAuditEvent(audit);
    return toSafeImage(row);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "MEDIA_NOT_FOUND", "Image not found");
    }
    throw err;
  }
}

async function removeImage(productId, companyId, imageId, actor = null) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  await assertProduct(productId, false, companyId);
  const existing = await mediaRepository.findImageByIdAndProductId(imageId, productId);
  if (!existing) {
    throw new AppError(404, "MEDIA_NOT_FOUND", "Image not found");
  }

  try {
    await mediaRepository.deleteImage(existing.id);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "MEDIA_NOT_FOUND", "Image not found");
    }
    throw err;
  }

  try {
    await localStorageAdapter.remove(existing.storagePath);
  } catch (err) {
    logger.warn("Image file cleanup failed after metadata deletion");
  }

  await recordAuditEvent(
    imageEvent(await snapshotActor(actor), companyId, productId, "removed", existing.id)
  );

  return { id: existing.id, message: "Image deleted successfully" };
}

module.exports = { listImages, getImage, uploadImage, updateImageMetadata, removeImage };
