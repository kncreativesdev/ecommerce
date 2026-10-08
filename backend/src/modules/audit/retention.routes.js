const express = require("express");

const auditController = require("./audit.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext } = require("../../middleware/companyContext");

const router = express.Router();

/**
 * Global audit retention policy (Phase 2C-19, SUPER_ADMIN only).
 *
 * Chain: authenticate → companyContext → authorize(SUPER_ADMIN).
 * Deliberately NO requireActiveCompany: this is platform
 * configuration, and a suspended company must never block it
 * (same posture as the company-management routes). No companyId
 * is accepted anywhere on this resource.
 */
const superAdmin = [authenticate, resolveCompanyContext, authorize("SUPER_ADMIN")];

router.get("/", ...superAdmin, auditController.getRetention);
router.patch("/", ...superAdmin, auditController.updateRetention);

module.exports = router;
