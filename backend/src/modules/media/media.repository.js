const { prisma } = require("../../config/database");

const IMAGE_SELECT = {
  id: true,
  productId: true,
  variantId: true,
  filename: true,
  storagePath: true,
  imageType: true,
  altText: true,
  sortOrder: true,
  isPrimary: true,
  createdAt: true,
  updatedAt: true,
};

async function findImagesByProduct(productId) {
  return prisma.productImage.findMany({
    where: { productId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: IMAGE_SELECT,
  });
}

async function findImageByIdAndProductId(imageId, productId) {
  return prisma.productImage.findFirst({
    where: { id: imageId, productId },
    select: IMAGE_SELECT,
  });
}

async function createImage(data, client = prisma) {
  return client.productImage.create({
    data,
    select: IMAGE_SELECT,
  });
}

async function updateImage(imageId, data, client = prisma) {
  return client.productImage.update({
    where: { id: imageId },
    data,
    select: IMAGE_SELECT,
  });
}

async function demoteOtherImages(productId, exceptImageId, client = prisma) {
  return client.productImage.updateMany({
    where: {
      productId,
      isPrimary: true,
      ...(exceptImageId ? { id: { not: exceptImageId } } : {}),
    },
    data: { isPrimary: false },
  });
}

async function deleteImage(imageId) {
  return prisma.productImage.delete({
    where: { id: imageId },
    select: IMAGE_SELECT,
  });
}

module.exports = {
  findImagesByProduct,
  findImageByIdAndProductId,
  createImage,
  updateImage,
  deleteImage,
  demoteOtherImages,
};
