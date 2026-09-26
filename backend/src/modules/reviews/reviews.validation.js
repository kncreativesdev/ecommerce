const { z } = require("zod");

const MIN_RATING = 1;
const MAX_RATING = 5;
const MAX_TITLE_LENGTH = 255;
const MAX_COMMENT_LENGTH = 5000;

const ratingSchema = z.number().int().min(MIN_RATING).max(MAX_RATING);
const titleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH);
const commentSchema = z.string().trim().min(1).max(MAX_COMMENT_LENGTH);

const createReviewSchema = z
  .object({
    orderItemId: z.string().uuid(),
    rating: ratingSchema,
    title: titleSchema.nullable().optional(),
    comment: commentSchema.nullable().optional(),
  })
  .strict();

const updateReviewSchema = z
  .object({
    rating: ratingSchema.optional(),
    title: titleSchema.nullable().optional(),
    comment: commentSchema.nullable().optional(),
  })
  .strict();

const reviewIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

const productIdParamSchema = z
  .object({
    productId: z.string().uuid(),
  })
  .strict();

/**
 * Admin review list query. Every field is explicit. `isApproved` arrives
 * as a query string, so it is an explicit "true"/"false" enum (never
 * `z.coerce.boolean()`, which maps "false" to true). `search` matches
 * review title/comment plus the reviewed product name and the reviewer's
 * email/name. Unknown params are stripped (not rejected) so pagination
 * links never 422 the list.
 */
const adminReviewListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    isApproved: z.enum(["true", "false"]).optional(),
    rating: z.coerce.number().int().min(MIN_RATING).max(MAX_RATING).optional(),
    productId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(100).optional(),
    sortBy: z.enum(["createdAt"]).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  })
  .strip();

/**
 * Admin moderation mutation. The moderation model is the actual
 * `isApproved` boolean (no invented enum): `true` approves/publishes,
 * `false` rejects back to pending. Rejected reviews stay stored and
 * discoverable via the `isApproved=false` filter.
 */
const updateReviewApprovedSchema = z
  .object({
    isApproved: z.boolean(),
  })
  .strict();

module.exports = {
  createReviewSchema,
  updateReviewSchema,
  reviewIdParamSchema,
  productIdParamSchema,
  adminReviewListQuerySchema,
  updateReviewApprovedSchema,
  MIN_RATING,
  MAX_RATING,
  MAX_TITLE_LENGTH,
  MAX_COMMENT_LENGTH,
};
