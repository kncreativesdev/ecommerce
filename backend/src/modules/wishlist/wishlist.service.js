const { AppError } = require("../../utils/appError");
const wishlistRepository = require("./wishlist.repository");
const { toSafeWishlist } = require("./wishlist.utils");

async function readSafeWishlist(userId) {
  const wishlist = await wishlistRepository.findWishlistWithItemsByUserId(userId);
  if (!wishlist) {
    throw new AppError(404, "WISHLIST_NOT_FOUND", "Wishlist not found");
  }
  return toSafeWishlist(wishlist);
}

async function getWishlist(userId) {
  await wishlistRepository.ensureWishlistByUserId(userId);
  return readSafeWishlist(userId);
}

async function addItem(userId, input) {
  const wishlist = await wishlistRepository.ensureWishlistByUserId(userId);

  const product = await wishlistRepository.findProductForWishlist(input.productId);
  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  if (!product.isActive) {
    throw new AppError(422, "PRODUCT_INACTIVE", "Product is not available");
  }

  try {
    await wishlistRepository.createWishlistItem(wishlist.id, input.productId);
  } catch (err) {
    if (err.code === "P2002") {
      throw new AppError(409, "WISHLIST_ITEM_EXISTS", "Product is already in the wishlist");
    }
    throw err;
  }
  return readSafeWishlist(userId);
}

async function removeItem(userId, itemId) {
  const wishlist = await wishlistRepository.ensureWishlistByUserId(userId);

  const deleted = await wishlistRepository.deleteWishlistItemByIdAndWishlistId(itemId, wishlist.id);
  if (deleted === 0) {
    throw new AppError(404, "WISHLIST_ITEM_NOT_FOUND", "Wishlist item not found");
  }
  return readSafeWishlist(userId);
}

module.exports = { getWishlist, addItem, removeItem };
