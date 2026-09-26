const multer = require("multer");
const path = require("path");

const { AppError } = require("../../utils/appError");

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new AppError(400, "MEDIA_INVALID_TYPE", "Only JPEG, PNG, and WebP images are allowed"));
  }
  return cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter,
});

function uploadSingleImage(req, res, next) {
  upload.single("image")(req, res, (err) => {
    if (!err) {
      return next();
    }
    if (err instanceof AppError) {
      return next(err);
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      return next(
        new AppError(413, "MEDIA_FILE_TOO_LARGE", "Image exceeds the maximum allowed size of 5MB")
      );
    }
    return next(new AppError(400, "MEDIA_UPLOAD_FAILED", "Image upload failed"));
  });
}

module.exports = { uploadSingleImage, MAX_FILE_SIZE };
