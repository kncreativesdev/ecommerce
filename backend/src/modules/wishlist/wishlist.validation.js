const { z } = require("zod");

const addItemSchema = z
  .object({
    productId: z.string().uuid(),
  })
  .strict();

const wishlistItemIdParamSchema = z
  .object({
    itemId: z.string().uuid(),
  })
  .strict();

module.exports = { addItemSchema, wishlistItemIdParamSchema };
