const { AppError } = require("../../utils/appError");
const reviewsRepository = require("./reviews.repository");
const { toSafeReview, toSafeAdminReview, toSafePublicReview } = require("./reviews.utils");

const UPDATABLE_FIELDS = ["rating", "title", "comment"];

const ADMIN_DEFAULT_PAGE = 1;
const ADMIN_DEFAULT_LIMIT = 20;
const ADMIN_MAX_LIMIT = 100;

async function createReview(userId, input) {
  const orderItem = await reviewsRepository.findOrderItemForReview(input.orderItemId, userId);
  if (!orderItem) {
    throw new AppError(404, "REVIEW_ORDER_ITEM_NOT_FOUND", "Order item not found");
  }

  try {
    const row = await reviewsRepository.createReview({
      userId,
      productId: orderItem.productId,
      orderItemId: orderItem.id,
      rating: input.rating,
      title: input.title ?? null,
      comment: input.comment ?? null,
    });
    return toSafeReview(row);
  } catch (err) {
    if (err.code === "P2002") {
      throw new AppError(409, "REVIEW_ALREADY_EXISTS", "Review already exists for this product");
    }
    throw err;
  }
}

async function listMyReviews(userId) {
  const rows = await reviewsRepository.findReviewsByUserId(userId);
  return rows.map(toSafeReview);
}

async function getReview(userId, id) {
  const row = await reviewsRepository.findReviewByIdAndUserId(id, userId);
  if (!row) {
    throw new AppError(404, "REVIEW_NOT_FOUND", "Review not found");
  }
  return toSafeReview(row);
}

async function updateReview(userId, id, input) {
  const data = {};
  for (const field of UPDATABLE_FIELDS) {
    if (input[field] !== undefined) {
      data[field] = input[field];
    }
  }
  if (Object.keys(data).length === 0) {
    throw new AppError(422, "REVIEW_UPDATE_INVALID", "No updatable fields provided");
  }

  const row = await reviewsRepository.updateReviewByIdAndUserId(id, userId, data);
  if (!row) {
    throw new AppError(404, "REVIEW_NOT_FOUND", "Review not found");
  }
  return toSafeReview(row);
}

async function deleteReview(userId, id) {
  const deleted = await reviewsRepository.deleteReviewByIdAndUserId(id, userId);
  if (deleted === 0) {
    throw new AppError(404, "REVIEW_NOT_FOUND", "Review not found");
  }
  return { id, message: "Review deleted successfully" };
}

async function listReviewsAdmin(query) {
  const page = query.page ?? ADMIN_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? ADMIN_DEFAULT_LIMIT, ADMIN_MAX_LIMIT);
  const search = query.search ? query.search.trim() : "";
  const { rows, total } = await reviewsRepository.findReviewsAdmin({
    isApproved: query.isApproved === undefined ? null : query.isApproved === "true",
    rating: query.rating ?? null,
    productId: query.productId ?? null,
    userId: query.userId ?? null,
    search: search === "" ? null : search,
    sortBy: query.sortBy ?? "createdAt",
    sortOrder: query.sortOrder ?? "desc",
    skip: (page - 1) * limit,
    take: limit,
  });
  return {
    reviews: rows.map(toSafeAdminReview),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function setReviewApprovedAdmin(id, isApproved) {
  try {
    const row = await reviewsRepository.setReviewApproved(id, isApproved);
    return toSafeAdminReview(row);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "REVIEW_NOT_FOUND", "Review not found");
    }
    throw err;
  }
}

async function deleteReviewAdmin(id) {
  try {
    await reviewsRepository.deleteReviewByIdAdmin(id);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "REVIEW_NOT_FOUND", "Review not found");
    }
    throw err;
  }
  return { id, message: "Review deleted successfully" };
}

async function listProductReviews(productId) {
  const rows = await reviewsRepository.findApprovedReviewsByProductId(productId);
  return rows.map(toSafePublicReview);
}

module.exports = {
  createReview,
  listMyReviews,
  getReview,
  updateReview,
  deleteReview,
  listReviewsAdmin,
  setReviewApprovedAdmin,
  deleteReviewAdmin,
  listProductReviews,
};
