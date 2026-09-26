const { prisma } = require("../../config/database");

const PRODUCT_BRIEF_SELECT = {
  id: true,
  name: true,
  slug: true,
  brand: true,
  isActive: true,
  // Default-variant display data (wishlist stays product-level by design —
  // no variant is persisted; the frontend shows the first purchasable
  // variant and its image from this brief when the catalog row is absent).
  variants: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      isActive: true,
    },
  },
};

const WISHLIST_ITEM_WITH_PRODUCT_SELECT = {
  id: true,
  wishlistId: true,
  productId: true,
  createdAt: true,
  product: {
    select: PRODUCT_BRIEF_SELECT,
  },
};

const WISHLIST_WITH_ITEMS_SELECT = {
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: { createdAt: "asc" },
    select: WISHLIST_ITEM_WITH_PRODUCT_SELECT,
  },
};

async function ensureWishlistByUserId(userId) {
  const existing = await prisma.wishlist.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existing) {
    return existing;
  }
  try {
    return await prisma.wishlist.create({
      data: { userId },
      select: { id: true },
    });
  } catch (err) {
    if (err.code === "P2002") {
      return prisma.wishlist.findUniqueOrThrow({
        where: { userId },
        select: { id: true },
      });
    }
    throw err;
  }
}

async function findWishlistWithItemsByUserId(userId) {
  return prisma.wishlist.findUnique({
    where: { userId },
    select: WISHLIST_WITH_ITEMS_SELECT,
  });
}

async function findProductForWishlist(productId) {
  return prisma.product.findUnique({
    where: { id: productId },
    select: PRODUCT_BRIEF_SELECT,
  });
}

async function createWishlistItem(wishlistId, productId) {
  return prisma.wishlistItem.create({
    data: { wishlistId, productId },
    select: { id: true },
  });
}

async function deleteWishlistItemByIdAndWishlistId(itemId, wishlistId) {
  const result = await prisma.wishlistItem.deleteMany({
    where: { id: itemId, wishlistId },
  });
  return result.count;
}

module.exports = {
  ensureWishlistByUserId,
  findWishlistWithItemsByUserId,
  findProductForWishlist,
  createWishlistItem,
  deleteWishlistItemByIdAndWishlistId,
};
