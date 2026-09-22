import {
  MEDIA_ALLOWED_EXTENSIONS,
  MEDIA_ALLOWED_MIME_TYPES,
  MEDIA_MAX_FILE_SIZE,
} from '../services/media.service.js';

/**
 * Shared pre-upload image selection rules (single implementation used by
 * the product-edit `MediaManager` and the product-create pending-images
 * section). Limits mirror the backend exactly (`media.upload.js` multer
 * limits + `imageProcessing.js` Sharp pipeline): JPEG/PNG/WebP by MIME
 * AND extension, ≤ 5 MB, ≤ 8000px per side. Dimensions can only be
 * verified server-side (Sharp); the client rejects type/size/emptiness
 * and surfaces dimension (or spoofed-content) rejections from the real
 * backend error codes via `mediaUploadErrorMessage`.
 *
 * Object URLs created for previews are LOCAL ONLY — revoked on remove /
 * replace / unmount, never persisted, never stored in Zustand, never
 * confused with server `storagePath` URLs.
 */

export function fileExtension(name) {
  const dot = (name ?? '').lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

export function validateChosenFile(file) {
  if (!MEDIA_ALLOWED_MIME_TYPES.includes(file.type) || !MEDIA_ALLOWED_EXTENSIONS.includes(fileExtension(file.name))) {
    return 'Only JPEG, PNG, or WebP images are allowed.';
  }
  if (file.size > MEDIA_MAX_FILE_SIZE) {
    return 'Image must be 5 MB or smaller.';
  }
  if (file.size === 0) {
    return 'Selected file is empty.';
  }
  return null;
}

/** Truthful per-file failure text from real backend media error codes. */
export function mediaUploadErrorMessage(error) {
  const code = error?.code;
  if (code === 'MEDIA_INVALID_TYPE') {
    return 'Rejected: not a valid JPEG/PNG/WebP image (or dimensions exceed 8000px).';
  }
  if (code === 'MEDIA_FILE_TOO_LARGE') {
    return 'Image must be 5 MB or smaller.';
  }
  if (code === 'PRODUCT_VARIANT_NOT_FOUND') {
    return 'Selected variant no longer exists.';
  }
  if (code === 'PRODUCT_NOT_FOUND') {
    return 'Product no longer exists.';
  }
  return error?.message ?? 'Upload failed. Please try again.';
}

let pendingImageId = 0;

export function nextPendingImageId() {
  pendingImageId += 1;
  return `pending-image-${pendingImageId}`;
}
