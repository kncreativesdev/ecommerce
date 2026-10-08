const couponsService = require("./coupons.service");
const {
  createCouponSchema,
  updateCouponSchema,
  couponIdParamSchema,
  validateCouponRequestSchema,
  adminCouponListQuerySchema,
  couponHistoryQuerySchema,
} = require("./coupons.validation");

/**
 * Server-resolved tenant for coupon operations. The mounted
 * companyContext guarantees the value (or rejects the request first);
 * a missing value fails closed inside the service.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function list(req, res, next) {
  try {
    const query = adminCouponListQuerySchema.parse(req.query);
    const { coupons, pagination } = await couponsService.listCouponsAdmin(companyIdOf(req), query);
    return res.status(200).json({ success: true, data: { coupons }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const params = couponIdParamSchema.parse({ id: req.params.id });
    const coupon = await couponsService.getCoupon(companyIdOf(req), params.id);
    return res.status(200).json({ success: true, data: { coupon } });
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const input = createCouponSchema.parse(req.body);
    const coupon = await couponsService.createCoupon(companyIdOf(req), input, { id: req.user.id });
    return res.status(201).json({ success: true, data: { coupon } });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const params = couponIdParamSchema.parse({ id: req.params.id });
    const input = updateCouponSchema.parse(req.body);
    const coupon = await couponsService.updateCoupon(companyIdOf(req), params.id, input, { id: req.user.id });
    return res.status(200).json({ success: true, data: { coupon } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const params = couponIdParamSchema.parse({ id: req.params.id });
    const { id } = await couponsService.deleteCoupon(companyIdOf(req), params.id, { id: req.user.id });
    return res.status(200).json({ success: true, data: { id, message: "Coupon deleted" } });
  } catch (err) {
    return next(err);
  }
}

async function history(req, res, next) {
  try {
    const params = couponIdParamSchema.parse({ id: req.params.id });
    const query = couponHistoryQuerySchema.parse(req.query);
    const { history, pagination } = await couponsService.listCouponHistory(companyIdOf(req), params.id, query);
    return res.status(200).json({ success: true, data: { history }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function validateForCart(req, res, next) {
  try {
    const input = validateCouponRequestSchema.parse(req.body);
    const result = await couponsService.validateCouponForUserCart(req.user.id, companyIdOf(req), input.code);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, remove, history, validateForCart };
