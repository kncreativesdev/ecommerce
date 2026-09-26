const reviewsService = require("./reviews.service");
const {
  createReviewSchema,
  updateReviewSchema,
  reviewIdParamSchema,
  productIdParamSchema,
  adminReviewListQuerySchema,
  updateReviewApprovedSchema,
} = require("./reviews.validation");

async function create(req, res, next) {
  try {
    const input = createReviewSchema.parse(req.body);
    const review = await reviewsService.createReview(req.user.id, input);
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
    const { reviews, pagination } = await reviewsService.listReviewsAdmin(query);
    return res.status(200).json({ success: true, data: { reviews }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function updateApprovedAdmin(req, res, next) {
  try {
    const params = reviewIdParamSchema.parse({ id: req.params.id });
    const input = updateReviewApprovedSchema.parse(req.body);
    const review = await reviewsService.setReviewApprovedAdmin(params.id, input.isApproved);
    return res.status(200).json({ success: true, data: { review } });
  } catch (err) {
    return next(err);
  }
}

async function removeAdmin(req, res, next) {
  try {
    const params = reviewIdParamSchema.parse({ id: req.params.id });
    const result = await reviewsService.deleteReviewAdmin(params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

async function listByProduct(req, res, next) {
  try {
    const params = productIdParamSchema.parse({ productId: req.params.productId });
    const reviews = await reviewsService.listProductReviews(params.productId);
    return res.status(200).json({ success: true, data: reviews });
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, listMine, getById, update, remove, listAdmin, updateApprovedAdmin, removeAdmin, listByProduct };
