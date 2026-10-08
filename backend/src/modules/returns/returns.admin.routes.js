const express = require("express");

const returnsController = require("./returns.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

// Admin return-request reads. Mounted at top-level `/returns` (see
// routes/index.js) — separate from the customer nested router under
// `/orders/:orderId/returns`, which keeps owning order reads and request
// creation. No status-mutation endpoint exists: the backend workflow
// defines creation + history only, so the admin surface is read-only.
router.get("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), returnsController.listAdmin);
router.get("/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), returnsController.getByIdAdmin);

module.exports = router;
