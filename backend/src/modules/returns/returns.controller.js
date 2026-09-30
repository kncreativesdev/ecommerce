const returnsService = require("./returns.service");
const {
  orderIdParamSchema,
  returnIdParamSchema,
  createReturnSchema,
  adminReturnListQuerySchema,
} = require("./returns.validation");

async function create(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ orderId: req.params.orderId });
    const input = createReturnSchema.parse(req.body);
    const returnRequest = await returnsService.requestReturn(req.user.id, params.orderId, input);
    return res.status(201).json({ success: true, data: { returnRequest } });
  } catch (err) {
    return next(err);
  }
}

async function get(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ orderId: req.params.orderId });
    const returnRequest = await returnsService.getReturn(req.user.id, params.orderId);
    return res.status(200).json({ success: true, data: { returnRequest } });
  } catch (err) {
    return next(err);
  }
}

async function listAdmin(req, res, next) {
  try {
    const query = adminReturnListQuerySchema.parse(req.query);
    const { returns, pagination } = await returnsService.listReturnsAdmin(query);
    return res.status(200).json({ success: true, data: { returns }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function getByIdAdmin(req, res, next) {
  try {
    const params = returnIdParamSchema.parse({ id: req.params.id });
    const returnRequest = await returnsService.getReturnAdmin(params.id);
    return res.status(200).json({ success: true, data: { returnRequest } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, get, listAdmin, getByIdAdmin };
