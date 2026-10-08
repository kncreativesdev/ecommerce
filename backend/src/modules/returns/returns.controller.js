const returnsService = require("./returns.service");
const {
  orderIdParamSchema,
  returnIdParamSchema,
  createReturnSchema,
  adminReturnListQuerySchema,
} = require("./returns.validation");

/**
 * Server-resolved tenant for order-linked return operations. The
 * mounted companyContext guarantees the value (or rejects the request
 * first); a missing value fails closed inside the service.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function create(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ orderId: req.params.orderId });
    const input = createReturnSchema.parse(req.body);
    const returnRequest = await returnsService.requestReturn(req.user.id, companyIdOf(req), params.orderId, input);
    return res.status(201).json({ success: true, data: { returnRequest } });
  } catch (err) {
    return next(err);
  }
}

async function get(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ orderId: req.params.orderId });
    const returnRequest = await returnsService.getReturn(req.user.id, companyIdOf(req), params.orderId);
    return res.status(200).json({ success: true, data: { returnRequest } });
  } catch (err) {
    return next(err);
  }
}

async function listAdmin(req, res, next) {
  try {
    const query = adminReturnListQuerySchema.parse(req.query);
    const { returns, pagination } = await returnsService.listReturnsAdmin(companyIdOf(req), query);
    return res.status(200).json({ success: true, data: { returns }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function getByIdAdmin(req, res, next) {
  try {
    const params = returnIdParamSchema.parse({ id: req.params.id });
    const returnRequest = await returnsService.getReturnAdmin(companyIdOf(req), params.id);
    return res.status(200).json({ success: true, data: { returnRequest } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, get, listAdmin, getByIdAdmin };
