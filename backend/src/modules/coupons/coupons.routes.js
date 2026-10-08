const express = require("express");

const couponsController = require("./coupons.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

// Customer checkout preview (any authenticated role): validates a code
// against the CALLER'S cart and returns the authoritative discount quote.
// Declared before `/:id` for clarity (literal segment, POST-only here).
router.post("/validate", authenticate, resolveCompanyContext, requireActiveCompany, couponsController.validateForCart);

// Coupon management (Phase 3-6 RBAC slice, permissions.js coupon
// grants verbatim): reads → ADMIN/HEAD/MEMBER (MEMBER holds
// coupon:READ); create + update (incl. isActive toggles — HEAD holds
// DEACTIVATE) → ADMIN/HEAD; hard delete → ADMIN only (HEAD/MEMBER
// hold no coupon:DELETE; COUPON_IN_USE guard unchanged). Customer
// quote (`POST /validate`) is unchanged above.
router.get("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), couponsController.list);
router.get("/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), couponsController.getById);
router.get("/:id/history", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), couponsController.history);
router.post("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD"), couponsController.create);
router.patch("/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD"), couponsController.update);
router.delete("/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), couponsController.remove);

module.exports = router;
