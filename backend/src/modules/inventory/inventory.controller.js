const inventoryService = require("./inventory.service");
const {
  initializeSchema,
  adjustSchema,
  adminInventoryListQuerySchema,
  inventoryTransactionsQuerySchema,
} = require("./inventory.validation");

async function get(req, res, next) {
  try {
    const record = await inventoryService.getInventory(req.params.productId, req.params.variantId);
    return res.status(200).json({ success: true, data: { inventory: record } });
  } catch (err) {
    return next(err);
  }
}

async function initialize(req, res, next) {
  try {
    const input = initializeSchema.parse(req.body);
    const record = await inventoryService.initializeInventory(
      req.params.productId,
      req.params.variantId,
      input
    );
    return res.status(201).json({ success: true, data: { inventory: record } });
  } catch (err) {
    return next(err);
  }
}

async function adjust(req, res, next) {
  try {
    const input = adjustSchema.parse(req.body);
    const record = await inventoryService.adjustInventory(
      req.params.productId,
      req.params.variantId,
      input
    );
    return res.status(200).json({ success: true, data: { inventory: record } });
  } catch (err) {
    return next(err);
  }
}

async function listTransactions(req, res, next) {
  try {
    const query = inventoryTransactionsQuerySchema.parse(req.query);
    const { transactions, pagination } = await inventoryService.listTransactionsAdmin(
      req.params.productId,
      req.params.variantId,
      query
    );
    return res.status(200).json({ success: true, data: { transactions }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

module.exports = { get, initialize, adjust, listTransactions };
