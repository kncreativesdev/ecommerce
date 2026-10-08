const sharp = require("sharp");

const { AppError } = require("../../utils/appError");

const MAX_DIMENSION = 8000;
const IMAGE_TYPE = "webp";
const IMAGE_QUALITY = 82;

// Formats the shared pipeline accepts anywhere (multer extension/MIME
// gate first, Sharp content verification second). SVG and other
// script-capable/vector formats are never accepted: Sharp would
// rasterize some of them, so the format is allowlisted explicitly
// instead of relying on conversion alone.
const RASTER_FORMATS = new Set(["jpeg", "png", "webp"]);

/**
 * Rejects non-raster image content (SVG/vectors/unknown) before any
 * processing or storage. Sharp parses SVG metadata successfully, so
 * the format allowlist — not mere parseability — is the authority.
 */
async function assertRasterImage(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch (err) {
    throw new AppError(400, "MEDIA_INVALID_TYPE", "File is not a valid image");
  }
  if (!metadata || !RASTER_FORMATS.has(metadata.format)) {
    throw new AppError(400, "MEDIA_INVALID_TYPE", "Only JPEG, PNG, and WebP images are allowed");
  }
  return metadata;
}

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

module.exports = { processToWebp, assertRasterImage, MAX_DIMENSION, IMAGE_TYPE, IMAGE_QUALITY };
