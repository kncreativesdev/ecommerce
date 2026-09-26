const { prisma } = require("../../config/database");

const REVIEW_WITH_PRODUCT_SELECT = {
  id: true,
  productId: true,
  orderItemId: true,
  rating: true,
  title: true,
  comment: true,
  isApproved: true,
  createdAt: true,
  updatedAt: true,
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
};

const ADMIN_REVIEW_WITH_DETAILS_SELECT = {
  ...REVIEW_WITH_PRODUCT_SELECT,
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  },
  orderItem: {
    select: {
      id: true,
      orderId: true,
    },
  },
};

/**
 * Admin review list. Every filter is explicit — callers pass a normalized
 * filter object (service layer), never raw query params. No ownership
 * predicate: ADMIN authorization is enforced by route middleware. The
 * embedded user brief carries identity only — never hashes or tokens.
 */
async function findReviewsAdmin(filters) {
  const { isApproved, rating, productId, userId, search, sortBy, sortOrder, skip, take } =
    filters;

  const and = [];
  if (isApproved !== null && isApproved !== undefined) {
    and.push({ isApproved });
  }
  if (rating !== null && rating !== undefined) {
    and.push({ rating });
  }
  if (productId) {
    and.push({ productId });
  }
  if (userId) {
    and.push({ userId });
  }
  if (search) {
    and.push({
      OR: [
        { title: { contains: search } },
        { comment: { contains: search } },
        { product: { name: { contains: search } } },
        { user: { email: { contains: search } } },
        { user: { firstName: { contains: search } } },
        { user: { lastName: { contains: search } } },
      ],
    });
  }

  const where = and.length > 0 ? { AND: and } : {};
  const orderBy = sortBy === "createdAt" ? [{ createdAt: sortOrder }] : [{ createdAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy,
      skip,
      take,
      select: ADMIN_REVIEW_WITH_DETAILS_SELECT,
    }),
    prisma.review.count({ where }),
  ]);
  return { rows, total };
}

async function findReviewByIdAdmin(id) {
  return prisma.review.findUnique({
    where: { id },
    select: ADMIN_REVIEW_WITH_DETAILS_SELECT,
  });
}

async function setReviewApproved(id, isApproved) {
  return prisma.review.update({
    where: { id },
    data: { isApproved },
    select: ADMIN_REVIEW_WITH_DETAILS_SELECT,
  });
}

async function deleteReviewByIdAdmin(id) {
  return prisma.review.delete({
    where: { id },
    select: { id: true },
  });
}

async function findOrderItemForReview(orderItemId, userId) {
  return prisma.orderItem.findFirst({
    where: { id: orderItemId, order: { userId } },
    select: {
      id: true,
      productId: true,
      variantId: true,
      quantity: true,
      order: {
        select: { id: true, userId: true, status: true },
      },
      product: {
        select: { id: true, name: true, slug: true, isActive: true },
      },
    },
  });
}

async function createReview(data) {
  return prisma.review.create({
    data,
    select: REVIEW_WITH_PRODUCT_SELECT,
  });
}

async function findReviewsByUserId(userId) {
  return prisma.review.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: REVIEW_WITH_PRODUCT_SELECT,
  });
}

async function findReviewByIdAndUserId(id, userId) {
  return prisma.review.findFirst({
    where: { id, userId },
    select: REVIEW_WITH_PRODUCT_SELECT,
  });
}

async function updateReviewByIdAndUserId(id, userId, data) {
  const result = await prisma.review.updateMany({
    where: { id, userId },
    data,
  });
  if (result.count === 0) {
    return null;
  }
  return prisma.review.findUniqueOrThrow({
    where: { id },
    select: REVIEW_WITH_PRODUCT_SELECT,
  });
}

async function deleteReviewByIdAndUserId(id, userId) {
  const result = await prisma.review.deleteMany({
    where: { id, userId },
  });
  return result.count;
}

const PUBLIC_REVIEW_SELECT = {
  id: true,
  productId: true,
  rating: true,
  title: true,
  comment: true,
  createdAt: true,
  user: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
};

async function findApprovedReviewsByProductId(productId) {
  return prisma.review.findMany({
    where: { productId, isApproved: true },
    orderBy: { createdAt: "desc" },
    select: PUBLIC_REVIEW_SELECT,
  });
}

module.exports = {
  findOrderItemForReview,
  createReview,
  findReviewsByUserId,
  findReviewByIdAndUserId,
  updateReviewByIdAndUserId,
  deleteReviewByIdAndUserId,
  findReviewsAdmin,
  findReviewByIdAdmin,
  setReviewApproved,
  deleteReviewByIdAdmin,
  findApprovedReviewsByProductId,
};
