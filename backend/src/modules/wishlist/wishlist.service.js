const { AppError } = require("../../utils/appError");
const wishlistRepository = require("./wishlist.repository");
const { toSafeWishlist } = require("./wishlist.utils");

async function readSafeWishlist(userId, companyId = null) {
  const wishlist = await wishlistRepository.findWishlistWithItemsByUserId(userId);
  if (!wishlist) {
    throw new AppError(404, "WISHLIST_NOT_FOUND", "Wishlist not found");
  }
  // Read gate (mirrors cart assertCartCompany): a contaminated line
  // (pre-enforcement legacy, direct writes, or null-company catalog)
  // must never render foreign product data — the whole read fails
  // closed with the same 404 as unknown ids. Nothing is repaired here.
  if (typeof companyId === "string" && companyId !== "") {
    for (const item of wishlist.items || []) {
      if (!item.product || item.product.companyId !== companyId) {
        throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
      }
    }
  }
  return toSafeWishlist(wishlist);
}

async function getWishlist(userId, companyId = null) {
  await wishlistRepository.ensureWishlistByUserId(userId);
  return readSafeWishlist(userId, companyId);
}

/**
 * Phase 2C-5 tenant check: the wishlisted product must belong to the
 * authenticated user's company. Cross-company ids fail with the same
 * 404 as unknown ids — no existence oracle. A missing companyId fails
 * closed (platform contexts have no wishlist operations).
 */
async function addItem(userId, companyId, input) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  const wishlist = await wishlistRepository.ensureWishlistByUserId(userId);

  const product = await wishlistRepository.findProductForWishlist(input.productId);
  if (!product || product.companyId !== companyId) {
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
  return readSafeWishlist(userId, companyId);
}

async function removeItem(userId, companyId, itemId) {
  const wishlist = await wishlistRepository.ensureWishlistByUserId(userId);

  const deleted = await wishlistRepository.deleteWishlistItemByIdAndWishlistId(itemId, wishlist.id);
  if (deleted === 0) {
    throw new AppError(404, "WISHLIST_ITEM_NOT_FOUND", "Wishlist item not found");
  }
  return readSafeWishlist(userId, companyId);
}

module.exports = { getWishlist, addItem, removeItem };
