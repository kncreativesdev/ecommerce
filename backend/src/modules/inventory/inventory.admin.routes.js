const express = require("express");

const inventoryService = require("./inventory.service");
const { adminInventoryListQuerySchema } = require("./inventory.validation");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");

const router = express.Router();

async function listAdmin(req, res, next) {
  try {
    const query = adminInventoryListQuerySchema.parse(req.query);
    const { items, pagination } = await inventoryService.listInventoryAdmin(query);
    return res.status(200).json({ success: true, data: { items }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

// Cross-variant stock list. Mounted at top-level `/inventory` (see
// routes/index.js) — separate from the per-variant nested router, which
// keeps owning product/variant reads, init/adjust, and ledger history.
router.get("/", authenticate, authorize("ADMIN"), listAdmin);

module.exports = router;
