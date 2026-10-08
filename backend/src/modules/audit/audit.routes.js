const express = require("express");

const auditController = require("./audit.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

/**
 * Audit-log reads (Phase 2C-18).
 *
 * Chain: authenticate → companyContext → requireActiveCompany →
 * authorize(ADMIN, HEAD, MEMBER, SUPER_ADMIN). CUSTOMER and anonymous
 * callers never reach the controller (403/401). Suspended-company
 * members are refused like on every company route; SUPER_ADMIN uses
 * platform context and can still inspect suspended companies.
 * Responses use the explicit safe projection from the repository —
 * never raw Prisma models.
 */
router.get(
  "/",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authorize("ADMIN", "HEAD", "MEMBER", "SUPER_ADMIN"),
  auditController.list
);

// CSV export (Phase 2C-21). Same chain and the same visibility model
// as the read endpoint above — the service layer is shared, so scope
// and filters cannot diverge. Declared before any `/:id` route (none
// exists on this router) so the literal `export` segment is never
// captured as a parameter. No DELETE route exists here by design.
router.get(
  "/export",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authorize("ADMIN", "HEAD", "MEMBER", "SUPER_ADMIN"),
  auditController.exportLogs
);

// Analytics summary (Phase 2C-24). Same chain, same shared
// visibility builder, same filter vocabulary as the read/export
// endpoints — aggregates can only reflect rows the caller could
// list. Read-only; no mutation surface.
router.get(
  "/summary",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authorize("ADMIN", "HEAD", "MEMBER", "SUPER_ADMIN"),
  auditController.getSummary
);

module.exports = router;
