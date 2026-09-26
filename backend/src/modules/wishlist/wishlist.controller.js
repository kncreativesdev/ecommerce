const wishlistService = require("./wishlist.service");
const { addItemSchema, wishlistItemIdParamSchema } = require("./wishlist.validation");

async function get(req, res, next) {
  try {
    const wishlist = await wishlistService.getWishlist(req.user.id);
    return res.status(200).json({ success: true, data: { wishlist } });
  } catch (err) {
    return next(err);
  }
}

async function add(req, res, next) {
  try {
    const input = addItemSchema.parse(req.body);
    const wishlist = await wishlistService.addItem(req.user.id, input);
    return res.status(200).json({ success: true, data: { wishlist } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const params = wishlistItemIdParamSchema.parse({ itemId: req.params.itemId });
    const wishlist = await wishlistService.removeItem(req.user.id, params.itemId);
    return res.status(200).json({ success: true, data: { wishlist } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { get, add, remove };
