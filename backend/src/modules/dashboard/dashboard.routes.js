const express = require("express");

const dashboardController = require("./dashboard.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

// Aggregated operational analytics. ADMIN-only: counts and revenue across
// all customers must never leak to customer sessions.
router.get("/summary", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), dashboardController.summary);

module.exports = router;
