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

/**
 * Phase 2C-1 tenant check: the variant (and its parent product, as
 * defense against ownership drift) must belong to the authenticated
 * user's company. Cross-company ids fail with the same 404 as unknown
 * ids so callers cannot probe another company's catalog. A missing
 * companyId fails closed (platform contexts have no cart operations).
 */
function assertSameCompany(variant, companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  if (!variant || variant.companyId !== companyId || !variant.product || variant.product.companyId !== companyId) {
    throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
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

/**
 * Phase 2C-8 read gate: every rendered line's variant AND product must
 * belong to the reader's company. Mutation paths (2C-1) already refuse
 * foreign variants at write time and checkout refuses them
 * transactionally, but a contaminated line (pre-enforcement legacy,
 * direct writes, or null-company catalog) must never RENDER foreign
 * product/variant/image/price/stock data — the whole read fails closed
 * with the same 404 as unknown ids instead of returning mixed-company
 * cart data. Nothing is repaired or reassigned here.
 */
function assertCartCompany(cart, companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  for (const item of cart.items || []) {
    const variant = item.variant;
    if (
      !variant ||
      variant.companyId !== companyId ||
      !variant.product ||
      variant.product.companyId !== companyId
    ) {
      throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
    }
  }
  return cart;
}

async function readSafeCart(userId, companyId) {
  const cart = await cartRepository.findCartWithItemsByUserId(userId);
  if (!cart) {
    throw new AppError(404, "CART_NOT_FOUND", "Cart not found");
  }
  return toSafeCart(assertCartCompany(cart, companyId));
}

async function getCart(userId, companyId) {
  await cartRepository.ensureCartByUserId(userId);
  return readSafeCart(userId, companyId);
}

async function addItem(userId, companyId, input) {
  const cart = await cartRepository.ensureCartByUserId(userId);

  const variant = assertVariantPurchasable(
    assertSameCompany(await cartRepository.findVariantForCart(input.variantId), companyId)
  );

  const current = await cartRepository.findCartWithItemsByUserId(userId);
  const existingItem = (current ? current.items : []).find((item) => item.variantId === input.variantId);
  const existingQuantity = existingItem ? existingItem.quantity : 0;
  const requestedTotal = existingQuantity + input.quantity;

  if (requestedTotal > MAX_CART_QUANTITY) {
    throw new AppError(422, "CART_ITEM_QUANTITY_INVALID", "Requested quantity exceeds the supported range");
  }
  assertAvailableStock(variant, requestedTotal);

  await cartRepository.upsertCartItemIncrement(cart.id, input.variantId, input.quantity);
  return readSafeCart(userId, companyId);
}

async function updateItem(userId, companyId, itemId, input) {
  const cart = await cartRepository.ensureCartByUserId(userId);

  const item = await cartRepository.findCartItemByIdAndCartId(itemId, cart.id);
  if (!item) {
    throw new AppError(404, "CART_ITEM_NOT_FOUND", "Cart item not found");
  }

  const variant = assertVariantPurchasable(
    assertSameCompany(await cartRepository.findVariantForCart(item.variantId), companyId)
  );
  assertAvailableStock(variant, input.quantity);

  const updated = await cartRepository.updateCartItemQuantityByIdAndCartId(itemId, cart.id, input.quantity);
  if (updated === 0) {
    throw new AppError(404, "CART_ITEM_NOT_FOUND", "Cart item not found");
  }
  return readSafeCart(userId, companyId);
}

async function removeItem(userId, companyId, itemId) {
  const cart = await cartRepository.ensureCartByUserId(userId);

  const deleted = await cartRepository.deleteCartItemByIdAndCartId(itemId, cart.id);
  if (deleted === 0) {
    throw new AppError(404, "CART_ITEM_NOT_FOUND", "Cart item not found");
  }
  return readSafeCart(userId, companyId);
}

module.exports = { getCart, addItem, updateItem, removeItem };
