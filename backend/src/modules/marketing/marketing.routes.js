const express = require("express");

const marketingController = require("./marketing.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

// Customer-visible active broadcasts (authenticated; the bell is auth-only).
router.get("/active", authenticate, resolveCompanyContext, requireActiveCompany, marketingController.listActive);

// ADMIN management (declared before `/:id`).
router.get("/admin", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), marketingController.listAdmin);
router.post("/admin", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), marketingController.createAdmin);
router.get("/admin/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), marketingController.getByIdAdmin);
router.patch("/admin/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), marketingController.updateAdmin);
router.delete("/admin/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), marketingController.deleteAdmin);

module.exports = router;
