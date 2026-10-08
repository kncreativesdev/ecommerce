const express = require("express");

const ordersController = require("./orders.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

// Company order operations (authenticated staff with order:MANAGE).
// Declared before `/:id` so the literal `admin` segment is never
// captured as an order id. Phase 3-5 wires the permissions.js
// order:MANAGE grant (ADMIN/HEAD/MEMBER): status, payment, and bulk
// mutations plus the scoped reads share one MANAGE action — the
// matrix draws no finer distinction, and lifecycle/business
// validation (transitions, payments, stock, atomicity, retry) stays
// role-agnostic in the service. Customer checkout/history routes
// below are unchanged.
router.get("/admin", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), ordersController.listAdmin);
router.patch("/admin/bulk-status", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), ordersController.bulkUpdateStatusAdmin);
router.get("/admin/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), ordersController.getByIdAdmin);
router.patch("/admin/:id/status", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), ordersController.updateStatusAdmin);
router.patch(
  "/admin/:id/payment",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authorize("ADMIN", "HEAD", "MEMBER"),
  ordersController.updatePaymentAdmin
);

router.post("/", authenticate, resolveCompanyContext, requireActiveCompany, ordersController.create);
router.get("/", authenticate, resolveCompanyContext, requireActiveCompany, ordersController.list);
// Customer self-cancellation (ownership + lifecycle enforced in service).
// Declared before `/:id` so the literal `cancel` action segment is never
// captured as an order id.
router.post("/:id/cancel", authenticate, resolveCompanyContext, requireActiveCompany, ordersController.cancel);
router.get("/:id", authenticate, resolveCompanyContext, requireActiveCompany, ordersController.getById);

module.exports = router;
