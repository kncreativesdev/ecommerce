const wishlistService = require("./wishlist.service");
const { addItemSchema, wishlistItemIdParamSchema } = require("./wishlist.validation");

async function get(req, res, next) {
  try {
    const wishlist = await wishlistService.getWishlist(req.user.id, companyIdOf(req));
    return res.status(200).json({ success: true, data: { wishlist } });
  } catch (err) {
    return next(err);
  }
}

/**
 * Server-resolved tenant for wishlist operations. Reads/removal are
 * userId-scoped (the caller's own wishlist only) with a company
 * read-gate (contaminated foreign lines fail closed); adds additionally
 * require the product's company to match. The mounted companyContext
 * guarantees the value (or rejects first).
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function add(req, res, next) {
  try {
    const input = addItemSchema.parse(req.body);
    const wishlist = await wishlistService.addItem(req.user.id, companyIdOf(req), input);
    return res.status(200).json({ success: true, data: { wishlist } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const params = wishlistItemIdParamSchema.parse({ itemId: req.params.itemId });
    const wishlist = await wishlistService.removeItem(req.user.id, companyIdOf(req), params.itemId);
    return res.status(200).json({ success: true, data: { wishlist } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { get, add, remove };
