const inventoryService = require("./inventory.service");
const {
  initializeSchema,
  adjustSchema,
  adminInventoryListQuerySchema,
  inventoryTransactionsQuerySchema,
} = require("./inventory.validation");

/**
 * Server-resolved tenant for inventory operations. The mounted
 * companyContext guarantees the value (or rejects the request first);
 * a missing value fails closed inside the service.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function get(req, res, next) {
  try {
    const record = await inventoryService.getInventory(req.params.productId, req.params.variantId, companyIdOf(req));
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
      companyIdOf(req),
      input,
      { id: req.user.id }
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
      companyIdOf(req),
      input,
      { id: req.user.id }
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
      companyIdOf(req),
      query
    );
    return res.status(200).json({ success: true, data: { transactions }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

module.exports = { get, initialize, adjust, listTransactions };
