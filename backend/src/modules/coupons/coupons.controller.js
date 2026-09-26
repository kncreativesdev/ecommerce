const couponsService = require("./coupons.service");
const {
  createCouponSchema,
  updateCouponSchema,
  couponIdParamSchema,
  validateCouponRequestSchema,
  adminCouponListQuerySchema,
} = require("./coupons.validation");

async function list(req, res, next) {
  try {
    const query = adminCouponListQuerySchema.parse(req.query);
    const { coupons, pagination } = await couponsService.listCouponsAdmin(query);
    return res.status(200).json({ success: true, data: { coupons }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const params = couponIdParamSchema.parse({ id: req.params.id });
    const coupon = await couponsService.getCoupon(params.id);
    return res.status(200).json({ success: true, data: { coupon } });
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const input = createCouponSchema.parse(req.body);
    const coupon = await couponsService.createCoupon(input);
    return res.status(201).json({ success: true, data: { coupon } });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const params = couponIdParamSchema.parse({ id: req.params.id });
    const input = updateCouponSchema.parse(req.body);
    const coupon = await couponsService.updateCoupon(params.id, input);
    return res.status(200).json({ success: true, data: { coupon } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const params = couponIdParamSchema.parse({ id: req.params.id });
    const { id } = await couponsService.deleteCoupon(params.id);
    return res.status(200).json({ success: true, data: { id, message: "Coupon deleted" } });
  } catch (err) {
    return next(err);
  }
}

async function validateForCart(req, res, next) {
  try {
    const input = validateCouponRequestSchema.parse(req.body);
    const result = await couponsService.validateCouponForUserCart(req.user.id, input.code);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, remove, validateForCart };
