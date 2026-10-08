const express = require("express");

const usersController = require("./users.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

router.get("/me", authenticate, resolveCompanyContext, requireActiveCompany, usersController.getMe);
router.patch("/me", authenticate, resolveCompanyContext, requireActiveCompany, usersController.updateMe);

// Admin user administration. Literal `/me` routes above win over `/:id`
// by definition order. Responses use the safe user shape only — never
// password hashes or tokens.
router.get("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD"), usersController.listAdmin);
router.post("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD"), usersController.createEmployee);
router.get("/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD"), usersController.getByIdAdmin);
router.patch("/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD"), usersController.updateActiveAdmin);
// Phase 2C-31 manager-driven MEMBER profile update (ADMIN + HEAD).
// Declared before `/:id` is unnecessary (two segments never collide
// with one), but grouping write routes keeps the surface readable.
// HEAD callers resolve MEMBER targets only; ADMIN keeps its existing
// lifecycle behavior on `/:id` untouched.
router.patch("/:id/profile", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD"), usersController.updateMemberProfile);

module.exports = router;
