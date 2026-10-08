const express = require("express");

const inventoryController = require("./inventory.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router({ mergeParams: true });

// Phase 3-4 inventory RBAC slice (permissions.js inventory grants:
// ADMIN + HEAD hold CREATE/READ/UPDATE/DEACTIVATE, MEMBER holds
// CREATE/READ/UPDATE). Every operation below is a CREATE, READ, or
// UPDATE: initialize (CREATE), adjust ±delta (UPDATE — negative
// deltas included; insufficient stock stays a business 409, never an
// auth error), detail + ledger reads (READ). No inventory endpoint
// performs deactivation or deletion, so the DEACTIVATE grant wires
// nothing and no service guard is needed — the service is
// role-agnostic (company predicates + actor snapshots only).
// Reads stay company-scoped; SUPER_ADMIN/CUSTOMER have no grant.
router.get("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), inventoryController.get);
router.post("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), inventoryController.initialize);
router.patch("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), inventoryController.adjust);
router.get("/transactions", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), inventoryController.listTransactions);

module.exports = router;
