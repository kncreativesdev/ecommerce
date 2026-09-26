const { z } = require("zod");

const notificationIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

const notificationListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    // When "true", only unread rows are returned. Any other value (or
    // omission) returns the newest rows regardless of read state.
    unreadOnly: z.enum(["true", "false"]).optional(),
  })
  .strip();

module.exports = {
  notificationIdParamSchema,
  notificationListQuerySchema,
};
