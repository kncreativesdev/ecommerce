const express = require("express");

const dashboardController = require("./dashboard.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");

const router = express.Router();

// Aggregated operational analytics. ADMIN-only: counts and revenue across
// all customers must never leak to customer sessions.
router.get("/summary", authenticate, authorize("ADMIN"), dashboardController.summary);

module.exports = router;
