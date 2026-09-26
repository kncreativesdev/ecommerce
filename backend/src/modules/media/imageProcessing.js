const sharp = require("sharp");

const { AppError } = require("../../utils/appError");

const MAX_DIMENSION = 8000;
const IMAGE_TYPE = "webp";
const IMAGE_QUALITY = 82;

/**
 * Shared upload image processing (MEDIA.md §6): content-verify the buffer
 * with Sharp (MIME/extension checks alone are spoofable), enforce the
 * 8000px-per-side limit, and convert to WebP before permanent storage.
 * Used by product uploads and category uploads alike.
 */
async function processToWebp(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch (err) {
    throw new AppError(400, "MEDIA_INVALID_TYPE", "File is not a valid image");
  }
  if (!metadata.format || !metadata.width || !metadata.height) {
    throw new AppError(400, "MEDIA_INVALID_TYPE", "File is not a valid image");
  }
  if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    throw new AppError(400, "MEDIA_INVALID_TYPE", `Image dimensions must not exceed ${MAX_DIMENSION}px`);
  }
  try {
    return await sharp(buffer).webp({ quality: IMAGE_QUALITY }).toBuffer();
  } catch (err) {
    throw new AppError(400, "MEDIA_INVALID_TYPE", "Image could not be processed");
  }
}

module.exports = { processToWebp, MAX_DIMENSION, IMAGE_TYPE, IMAGE_QUALITY };
