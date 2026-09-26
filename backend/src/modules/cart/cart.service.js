const { AppError } = require("../../utils/appError");
const cartRepository = require("./cart.repository");
const { toSafeCart } = require("./cart.utils");
const { MAX_CART_QUANTITY } = require("./cart.validation");

function assertVariantPurchasable(variant) {
  if (!variant) {
    throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
  }
  if (!variant.isActive || !variant.product || !variant.product.isActive) {
    throw new AppError(422, "PRODUCT_VARIANT_INACTIVE", "Product variant is not available for purchase");
  }
  return variant;
}

function assertAvailableStock(variant, requestedQuantity) {
  // Backend inventory is authoritative. A variant with no inventory record
  // cannot be purchased (uninitialized stock counts as out of stock in the
  // dashboard snapshot and fails at checkout with ORDER_INSUFFICIENT_STOCK),
  // so cart operations must reject it here with the same INSUFFICIENT_STOCK
  // code the frontend surfaces as an out-of-stock toast.
  if (!variant.inventory) {
    throw new AppError(409, "INSUFFICIENT_STOCK", "Product is out of stock");
  }
  const available = variant.inventory.quantity - variant.inventory.reservedQuantity;
  if (requestedQuantity > available) {
    throw new AppError(409, "INSUFFICIENT_STOCK", "Insufficient stock for the requested quantity");
  }
}

async function readSafeCart(userId) {
  const cart = await cartRepository.findCartWithItemsByUserId(userId);
  if (!cart) {
    throw new AppError(404, "CART_NOT_FOUND", "Cart not found");
  }
  return toSafeCart(cart);
}

async function getCart(userId) {
  await cartRepository.ensureCartByUserId(userId);
  return readSafeCart(userId);
}

async function addItem(userId, input) {
  const cart = await cartRepository.ensureCartByUserId(userId);

  const variant = assertVariantPurchasable(await cartRepository.findVariantForCart(input.variantId));

  const current = await cartRepository.findCartWithItemsByUserId(userId);
  const existingItem = (current ? current.items : []).find((item) => item.variantId === input.variantId);
  const existingQuantity = existingItem ? existingItem.quantity : 0;
  const requestedTotal = existingQuantity + input.quantity;

  if (requestedTotal > MAX_CART_QUANTITY) {
    throw new AppError(422, "CART_ITEM_QUANTITY_INVALID", "Requested quantity exceeds the supported range");
  }
  assertAvailableStock(variant, requestedTotal);

  await cartRepository.upsertCartItemIncrement(cart.id, input.variantId, input.quantity);
  return readSafeCart(userId);
}

async function updateItem(userId, itemId, input) {
  const cart = await cartRepository.ensureCartByUserId(userId);

  const item = await cartRepository.findCartItemByIdAndCartId(itemId, cart.id);
  if (!item) {
    throw new AppError(404, "CART_ITEM_NOT_FOUND", "Cart item not found");
  }

  const variant = assertVariantPurchasable(await cartRepository.findVariantForCart(item.variantId));
  assertAvailableStock(variant, input.quantity);

  const updated = await cartRepository.updateCartItemQuantityByIdAndCartId(itemId, cart.id, input.quantity);
  if (updated === 0) {
    throw new AppError(404, "CART_ITEM_NOT_FOUND", "Cart item not found");
  }
  return readSafeCart(userId);
}

async function removeItem(userId, itemId) {
  const cart = await cartRepository.ensureCartByUserId(userId);

  const deleted = await cartRepository.deleteCartItemByIdAndCartId(itemId, cart.id);
  if (deleted === 0) {
    throw new AppError(404, "CART_ITEM_NOT_FOUND", "Cart item not found");
  }
  return readSafeCart(userId);
}

module.exports = { getCart, addItem, updateItem, removeItem };
