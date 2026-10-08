const express = require("express");

const announcementsController = require("./announcements.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, resolvePublicCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

// Public storefront endpoint: safe fields only, no auth required.
router.get("/current", resolvePublicCompanyContext, requireActiveCompany, announcementsController.getCurrent);

// ADMIN management (declared before `/:id`).
router.get("/admin", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), announcementsController.listAdmin);
router.post("/admin", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), announcementsController.createAdmin);
router.get("/admin/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), announcementsController.getByIdAdmin);
router.patch(
  "/admin/:id",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authorize("ADMIN"),
  announcementsController.updateAdmin
);
router.delete(
  "/admin/:id",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authorize("ADMIN"),
  announcementsController.deleteAdmin
);

module.exports = router;
