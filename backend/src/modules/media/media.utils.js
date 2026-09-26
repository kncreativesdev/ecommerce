function toSafeImage(image) {
  return {
    id: image.id,
    productId: image.productId,
    variantId: image.variantId ?? null,
    filename: image.filename,
    storagePath: image.storagePath,
    imageType: image.imageType,
    altText: image.altText ?? null,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
  };
}

module.exports = { toSafeImage };
