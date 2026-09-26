const cartService = require("./cart.service");
const {
  addItemSchema,
  updateItemSchema,
  cartItemIdParamSchema,
} = require("./cart.validation");

async function get(req, res, next) {
  try {
    const cart = await cartService.getCart(req.user.id);
    return res.status(200).json({ success: true, data: { cart } });
  } catch (err) {
    return next(err);
  }
}

async function add(req, res, next) {
  try {
    const input = addItemSchema.parse(req.body);
    const cart = await cartService.addItem(req.user.id, input);
    return res.status(200).json({ success: true, data: { cart } });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const params = cartItemIdParamSchema.parse({ itemId: req.params.itemId });
    const input = updateItemSchema.parse(req.body);
    const cart = await cartService.updateItem(req.user.id, params.itemId, input);
    return res.status(200).json({ success: true, data: { cart } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const params = cartItemIdParamSchema.parse({ itemId: req.params.itemId });
    const cart = await cartService.removeItem(req.user.id, params.itemId);
    return res.status(200).json({ success: true, data: { cart } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { get, add, update, remove };
