const ordersService = require("./orders.service");
const {
  createOrderSchema,
  orderIdParamSchema,
  adminOrderListQuerySchema,
  updateOrderStatusSchema,
  updatePaymentStatusSchema,
  bulkUpdateOrderStatusSchema,
} = require("./orders.validation");

/**
 * Server-resolved tenant for checkout. The mounted companyContext
 * guarantees the value (or rejects the request first); a missing value
 * fails closed inside the order transaction.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function create(req, res, next) {
  try {
    const input = createOrderSchema.parse(req.body);
    const order = await ordersService.createOrder(req.user.id, companyIdOf(req), input);
    return res.status(201).json({ success: true, data: { order } });
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const orders = await ordersService.listOrders(req.user.id, companyIdOf(req));
    return res.status(200).json({ success: true, data: orders });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ id: req.params.id });
    const order = await ordersService.getOrder(req.user.id, companyIdOf(req), params.id);
    return res.status(200).json({ success: true, data: { order } });
  } catch (err) {
    return next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ id: req.params.id });
    const order = await ordersService.cancelOrder(req.user.id, companyIdOf(req), params.id);
    return res.status(200).json({ success: true, data: { order } });
  } catch (err) {
    return next(err);
  }
}

async function listAdmin(req, res, next) {
  try {
    const query = adminOrderListQuerySchema.parse(req.query);
    const { orders, pagination } = await ordersService.listOrdersAdmin(companyIdOf(req), query);
    return res.status(200).json({ success: true, data: { orders }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function getByIdAdmin(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ id: req.params.id });
    const order = await ordersService.getOrderAdmin(companyIdOf(req), params.id);
    return res.status(200).json({ success: true, data: { order } });
  } catch (err) {
    return next(err);
  }
}

async function updateStatusAdmin(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ id: req.params.id });
    const input = updateOrderStatusSchema.parse(req.body);
    const order = await ordersService.updateOrderStatusAdmin(companyIdOf(req), params.id, input.status, {
      note: input.note ?? null,
      createdBy: req.user?.id ?? null,
    }, { id: req.user.id });
    return res.status(200).json({ success: true, data: { order } });
  } catch (err) {
    return next(err);
  }
}

async function bulkUpdateStatusAdmin(req, res, next) {
  try {
    const input = bulkUpdateOrderStatusSchema.parse(req.body);
    const { orders } = await ordersService.bulkUpdateOrderStatusAdmin(companyIdOf(req), input.orderIds, input.status, {
      note: input.note ?? null,
      createdBy: req.user?.id ?? null,
    }, { id: req.user.id });
    return res.status(200).json({ success: true, data: { orders } });
  } catch (err) {
    return next(err);
  }
}

async function updatePaymentAdmin(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ id: req.params.id });
    const input = updatePaymentStatusSchema.parse(req.body);
    const order = await ordersService.updateOrderPaymentStatusAdmin(companyIdOf(req), params.id, input.status, {
      id: req.user.id,
    });
    return res.status(200).json({ success: true, data: { order } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getById, cancel, listAdmin, getByIdAdmin, updateStatusAdmin, bulkUpdateStatusAdmin, updatePaymentAdmin };
