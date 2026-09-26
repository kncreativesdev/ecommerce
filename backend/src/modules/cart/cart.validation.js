const { z } = require("zod");

const MAX_CART_QUANTITY = 2147483647;

const variantIdSchema = z.string().uuid();
const cartItemIdSchema = z.string().uuid();

const addItemSchema = z
  .object({
    variantId: variantIdSchema,
    quantity: z.number().int().min(1).max(MAX_CART_QUANTITY),
  })
  .strict();

const updateItemSchema = z
  .object({
    quantity: z.number().int().min(1).max(MAX_CART_QUANTITY),
  })
  .strict();

const cartItemIdParamSchema = z
  .object({
    itemId: cartItemIdSchema,
  })
  .strict();

module.exports = {
  addItemSchema,
  updateItemSchema,
  cartItemIdParamSchema,
  MAX_CART_QUANTITY,
};
