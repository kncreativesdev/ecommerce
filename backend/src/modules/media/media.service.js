const crypto = require("crypto");

const { AppError } = require("../../utils/appError");
const { logger } = require("../../utils/logger");
const { prisma } = require("../../config/database");
const mediaRepository = require("./media.repository");
const { findProductById, findVariantByIdAndProductId } = require("../products/products.repository");
const { localStorageAdapter } = require("./storage/local.storage");
const { processToWebp, IMAGE_TYPE } = require("./imageProcessing");
const { toSafeImage } = require("./media.utils");

const UPDATABLE_METADATA_FIELDS = ["variantId", "altText", "sortOrder", "isPrimary"];

async function assertProduct(productId, activeOnly) {
  const product = await findProductById(productId);
  if (!product || (activeOnly && !product.isActive)) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  return product;
}

async function assertVariant(productId, variantId) {
  const variant = await findVariantByIdAndProductId(variantId, productId);
  if (!variant) {
    throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
  }
  return variant;
}

async function listImages(productId) {
  await assertProduct(productId, true);
  const rows = await mediaRepository.findImagesByProduct(productId);
  return rows.map(toSafeImage);
}

async function getImage(productId, imageId) {
  await assertProduct(productId, true);
  const row = await mediaRepository.findImageByIdAndProductId(imageId, productId);
  if (!row) {
    throw new AppError(404, "MEDIA_NOT_FOUND", "Image not found");
  }
  return toSafeImage(row);
}

async function uploadImage(productId, file, meta) {
  await assertProduct(productId, false);
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new AppError(400, "MEDIA_UPLOAD_FAILED", "No image file uploaded");
  }
  if (meta.variantId !== undefined && meta.variantId !== null) {
    await assertVariant(productId, meta.variantId);
  }

  const webpBuffer = await processToWebp(file.buffer);
  const filename = `${crypto.randomUUID()}.webp`;
  const relativeDir = `products/${productId}`;

  let storagePath;
  try {
    storagePath = await localStorageAdapter.save(relativeDir, filename, webpBuffer);
  } catch (err) {
    logger.error({ err: err.message }, "Media storage write failed");
    throw new AppError(500, "MEDIA_STORAGE_FAILED", "Image storage failed");
  }

  try {
    const wantPrimary = meta.isPrimary === true;
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
      return toSafeImage(row);
    }
    // Product-level single-primary invariant: demoting siblings and
    // creating the new primary must be atomic so concurrent uploads or a
    // mid-flight failure can never leave two primaries behind.
    const row = await prisma.$transaction(async (tx) => {
      await mediaRepository.demoteOtherImages(productId, null, tx);
      return mediaRepository.createImage(
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

async function updateImageMetadata(productId, imageId, input) {
  await assertProduct(productId, false);
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
    await assertVariant(productId, data.variantId);
  }

  try {
    // Product-level single-primary invariant: setting one image primary
    // must demote every other image of the same product atomically.
    // Reads/writes for other products are never touched; the pre-check
    // above (findImageByIdAndProductId) already rejects mismatched
    // product/image ids with 404 before any write occurs.
    if (data.isPrimary === true) {
      const row = await prisma.$transaction(async (tx) => {
        await mediaRepository.demoteOtherImages(productId, existing.id, tx);
        return mediaRepository.updateImage(existing.id, data, tx);
      });
      return toSafeImage(row);
    }
    const row = await mediaRepository.updateImage(existing.id, data);
    return toSafeImage(row);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "MEDIA_NOT_FOUND", "Image not found");
    }
    throw err;
  }
}

async function removeImage(productId, imageId) {
  await assertProduct(productId, false);
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

  return { id: existing.id, message: "Image deleted successfully" };
}

module.exports = { listImages, getImage, uploadImage, updateImageMetadata, removeImage };
