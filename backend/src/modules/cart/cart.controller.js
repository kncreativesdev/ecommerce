const cartService = require("./cart.service");
const {
  addItemSchema,
  updateItemSchema,
  cartItemIdParamSchema,
} = require("./cart.validation");

async function get(req, res, next) {
  try {
    const cart = await cartService.getCart(req.user.id, companyIdOf(req));
    return res.status(200).json({ success: true, data: { cart } });
  } catch (err) {
    return next(err);
  }
}

/**
 * Server-resolved tenant for variant-touching cart operations. The
 * mounted companyContext guarantees the value (or rejects the request
 * first); a missing value fails closed inside the service.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function add(req, res, next) {
  try {
    const input = addItemSchema.parse(req.body);
    const cart = await cartService.addItem(req.user.id, companyIdOf(req), input);
    return res.status(200).json({ success: true, data: { cart } });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const params = cartItemIdParamSchema.parse({ itemId: req.params.itemId });
    const input = updateItemSchema.parse(req.body);
    const cart = await cartService.updateItem(req.user.id, companyIdOf(req), params.itemId, input);
    return res.status(200).json({ success: true, data: { cart } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const params = cartItemIdParamSchema.parse({ itemId: req.params.itemId });
    const cart = await cartService.removeItem(req.user.id, companyIdOf(req), params.itemId);
    return res.status(200).json({ success: true, data: { cart } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { get, add, update, remove };
