const ordersService = require("./orders.service");
const {
  createOrderSchema,
  orderIdParamSchema,
  adminOrderListQuerySchema,
  updateOrderStatusSchema,
  updatePaymentStatusSchema,
  bulkUpdateOrderStatusSchema,
} = require("./orders.validation");

async function create(req, res, next) {
  try {
    const input = createOrderSchema.parse(req.body);
    const order = await ordersService.createOrder(req.user.id, input);
    return res.status(201).json({ success: true, data: { order } });
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const orders = await ordersService.listOrders(req.user.id);
    return res.status(200).json({ success: true, data: orders });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ id: req.params.id });
    const order = await ordersService.getOrder(req.user.id, params.id);
    return res.status(200).json({ success: true, data: { order } });
  } catch (err) {
    return next(err);
  }
}

async function listAdmin(req, res, next) {
  try {
    const query = adminOrderListQuerySchema.parse(req.query);
    const { orders, pagination } = await ordersService.listOrdersAdmin(query);
    return res.status(200).json({ success: true, data: { orders }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function getByIdAdmin(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ id: req.params.id });
    const order = await ordersService.getOrderAdmin(params.id);
    return res.status(200).json({ success: true, data: { order } });
  } catch (err) {
    return next(err);
  }
}

async function updateStatusAdmin(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ id: req.params.id });
    const input = updateOrderStatusSchema.parse(req.body);
    const order = await ordersService.updateOrderStatusAdmin(params.id, input.status, {
      note: input.note ?? null,
      createdBy: req.user?.id ?? null,
    });
    return res.status(200).json({ success: true, data: { order } });
  } catch (err) {
    return next(err);
  }
}

async function bulkUpdateStatusAdmin(req, res, next) {
  try {
    const input = bulkUpdateOrderStatusSchema.parse(req.body);
    const { orders } = await ordersService.bulkUpdateOrderStatusAdmin(input.orderIds, input.status, {
      note: input.note ?? null,
      createdBy: req.user?.id ?? null,
    });
    return res.status(200).json({ success: true, data: { orders } });
  } catch (err) {
    return next(err);
  }
}

async function updatePaymentAdmin(req, res, next) {
  try {
    const params = orderIdParamSchema.parse({ id: req.params.id });
    const input = updatePaymentStatusSchema.parse(req.body);
    const order = await ordersService.updateOrderPaymentStatusAdmin(params.id, input.status);
    return res.status(200).json({ success: true, data: { order } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getById, listAdmin, getByIdAdmin, updateStatusAdmin, bulkUpdateStatusAdmin, updatePaymentAdmin };
