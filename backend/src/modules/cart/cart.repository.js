const { prisma } = require("../../config/database");

const VARIANT_FOR_CART_SELECT = {
  id: true,
  productId: true,
  sku: true,
  name: true,
  price: true,
  isActive: true,
};

const CART_IMAGE_SELECT = {
  orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  select: { storagePath: true, altText: true, sortOrder: true, isPrimary: true },
};

const CART_ITEM_WITH_VARIANT_SELECT = {
  id: true,
  cartId: true,
  variantId: true,
  quantity: true,
  createdAt: true,
  updatedAt: true,
  variant: {
    select: {
      ...VARIANT_FOR_CART_SELECT,
      images: CART_IMAGE_SELECT,
      inventory: {
        select: {
          quantity: true,
          reservedQuantity: true,
        },
      },
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
          images: CART_IMAGE_SELECT,
        },
      },
    },
  },
};

const CART_WITH_ITEMS_SELECT = {
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: { createdAt: "asc" },
    select: CART_ITEM_WITH_VARIANT_SELECT,
  },
};

async function ensureCartByUserId(userId) {
  const existing = await prisma.cart.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existing) {
    return existing;
  }
  try {
    return await prisma.cart.create({
      data: { userId },
      select: { id: true },
    });
  } catch (err) {
    if (err.code === "P2002") {
      return prisma.cart.findUniqueOrThrow({
        where: { userId },
        select: { id: true },
      });
    }
    throw err;
  }
}

async function findCartWithItemsByUserId(userId) {
  return prisma.cart.findUnique({
    where: { userId },
    select: CART_WITH_ITEMS_SELECT,
  });
}

async function findVariantForCart(variantId) {
  return prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      ...VARIANT_FOR_CART_SELECT,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
        },
      },
      inventory: {
        select: {
          quantity: true,
          reservedQuantity: true,
        },
      },
    },
  });
}

async function upsertCartItemIncrement(cartId, variantId, quantity) {
  try {
    return await prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId } },
      update: { quantity: { increment: quantity } },
      create: { cartId, variantId, quantity },
      select: { id: true, quantity: true },
    });
  } catch (err) {
    if (err.code !== "P2002") {
      throw err;
    }
    await prisma.cartItem.updateMany({
      where: { cartId, variantId },
      data: { quantity: { increment: quantity } },
    });
    return prisma.cartItem.findUniqueOrThrow({
      where: { cartId_variantId: { cartId, variantId } },
      select: { id: true, quantity: true },
    });
  }
}

async function findCartItemByIdAndCartId(itemId, cartId) {
  return prisma.cartItem.findFirst({
    where: { id: itemId, cartId },
    select: CART_ITEM_WITH_VARIANT_SELECT,
  });
}

async function updateCartItemQuantityByIdAndCartId(itemId, cartId, quantity) {
  const result = await prisma.cartItem.updateMany({
    where: { id: itemId, cartId },
    data: { quantity },
  });
  return result.count;
}

async function deleteCartItemByIdAndCartId(itemId, cartId) {
  const result = await prisma.cartItem.deleteMany({
    where: { id: itemId, cartId },
  });
  return result.count;
}

module.exports = {
  ensureCartByUserId,
  findCartWithItemsByUserId,
  findVariantForCart,
  upsertCartItemIncrement,
  findCartItemByIdAndCartId,
  updateCartItemQuantityByIdAndCartId,
  deleteCartItemByIdAndCartId,
};
