function toSafeReview(review) {
  return {
    id: review.id,
    productId: review.productId,
    orderItemId: review.orderItemId,
    rating: review.rating,
    title: review.title ?? null,
    comment: review.comment ?? null,
    isApproved: review.isApproved,
    product: review.product
      ? {
          id: review.product.id,
          name: review.product.name,
          slug: review.product.slug,
        }
      : null,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

/**
 * Admin review shape: the public-safe review plus the reviewer's identity
 * brief and the reviewed order-item link. Identity only — never password
 * hashes or tokens. Order records are never mutated by review operations.
 */
function toSafeAdminReview(review) {
  return {
    ...toSafeReview(review),
    customer: review.user
      ? {
          id: review.user.id,
          email: review.user.email,
          firstName: review.user.firstName ?? null,
          lastName: review.user.lastName ?? null,
        }
      : null,
    orderItem: review.orderItem
      ? {
          id: review.orderItem.id,
          orderId: review.orderItem.orderId,
        }
      : null,
  };
}

/**
 * Public product-review shape for the PDP: rating, text, display name, and
 * date only. Never exposes user ids, emails, order links, or approval
 * flags. The display name derives from the reviewer's first name (plus
 * last initial when available); anonymous fallback is "Verified buyer".
 */
function toSafePublicReview(review) {
  const firstName = review.user?.firstName?.trim() || "";
  const lastName = review.user?.lastName?.trim() || "";
  let author = "Verified buyer";
  if (firstName) {
    author = lastName ? `${firstName} ${lastName.charAt(0)}.` : firstName;
  }
  return {
    id: review.id,
    productId: review.productId,
    rating: review.rating,
    title: review.title ?? null,
    comment: review.comment ?? null,
    author,
    createdAt: review.createdAt,
  };
}

module.exports = { toSafeReview, toSafeAdminReview, toSafePublicReview };
