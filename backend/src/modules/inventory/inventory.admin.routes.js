const express = require("express");

const inventoryService = require("./inventory.service");
const { adminInventoryListQuerySchema } = require("./inventory.validation");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

/**
 * Server-resolved tenant for the cross-variant stock list (see
 * controller companyIdOf for the shared contract).
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function listAdmin(req, res, next) {
  try {
    const query = adminInventoryListQuerySchema.parse(req.query);
    const { items, pagination } = await inventoryService.listInventoryAdmin(companyIdOf(req), query);
    return res.status(200).json({ success: true, data: { items }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

// Cross-variant stock list. Mounted at top-level `/inventory` (see
// routes/index.js) — separate from the per-variant nested router, which
// keeps owning product/variant reads, init/adjust, and ledger history.
// Phase 3-4: READ mapping for ADMIN/HEAD/MEMBER (company-scoped rows).
router.get("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), listAdmin);

module.exports = router;
