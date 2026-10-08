const reviewsService = require("./reviews.service");
const {
  createReviewSchema,
  updateReviewSchema,
  reviewIdParamSchema,
  productIdParamSchema,
  adminReviewListQuerySchema,
} = require("./reviews.validation");

/**
 * Server-resolved tenant for review creation and admin reads. The
 * mounted companyContext guarantees the value (or rejects the request
 * first); a missing value fails closed inside the service. Caller-owned
 * reads/mutations and public product reviews take no company — they
 * are keyed by caller or product alone by design.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function create(req, res, next) {
  try {
    const input = createReviewSchema.parse(req.body);
    const review = await reviewsService.createReview(req.user.id, companyIdOf(req), input);
    return res.status(201).json({ success: true, data: { review } });
  } catch (err) {
    return next(err);
  }
}

async function listMine(req, res, next) {
  try {
    const reviews = await reviewsService.listMyReviews(req.user.id);
    return res.status(200).json({ success: true, data: reviews });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const params = reviewIdParamSchema.parse({ id: req.params.id });
    const review = await reviewsService.getReview(req.user.id, params.id);
    return res.status(200).json({ success: true, data: { review } });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const params = reviewIdParamSchema.parse({ id: req.params.id });
    const input = updateReviewSchema.parse(req.body);
    const review = await reviewsService.updateReview(req.user.id, params.id, input);
    return res.status(200).json({ success: true, data: { review } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const params = reviewIdParamSchema.parse({ id: req.params.id });
    const result = await reviewsService.deleteReview(req.user.id, params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

async function listAdmin(req, res, next) {
  try {
    const query = adminReviewListQuerySchema.parse(req.query);
    const { reviews, pagination } = await reviewsService.listReviewsAdmin(companyIdOf(req), query);
    return res.status(200).json({ success: true, data: { reviews }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function listByProduct(req, res, next) {
  try {
    const params = productIdParamSchema.parse({ productId: req.params.productId });
    const reviews = await reviewsService.listProductReviews(params.productId, companyIdOf(req));
    return res.status(200).json({ success: true, data: reviews });
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, listMine, getById, update, remove, listAdmin, listByProduct };
