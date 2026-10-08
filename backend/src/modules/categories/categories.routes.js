const express = require("express");

const categoriesController = require("./categories.controller");
const { uploadSingleImage } = require("../media/media.upload");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, resolvePublicCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");
const { requireAdminForInactiveScope } = require("../../middleware/requireAdminForInactiveScope");

const router = express.Router();

router.get("/", resolvePublicCompanyContext, requireActiveCompany, requireAdminForInactiveScope, categoriesController.list);
// Authenticated admin operational reads (identity company, never Host).
// Public storefront reads above stay Host-based and unchanged. The admin
// frontend must use these for company-scoped management so a Company B
// ADMIN never inherits Company A's catalog via the Host header.
// Declared before `/:id` so `admin` is never captured as an id.
router.get("/admin", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), requireAdminForInactiveScope, categoriesController.list);
router.get("/admin/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), requireAdminForInactiveScope, categoriesController.getById);
router.get("/:id", resolvePublicCompanyContext, requireActiveCompany, requireAdminForInactiveScope, categoriesController.getById);
// Phase 3-1 categories RBAC slice (permissions.js category grants):
// POST + PATCH → ADMIN/HEAD/MEMBER (MEMBER: no `isActive` — enforced
// in-service with 403); DELETE (soft-deactivate) + images are covered
// below. Reads stay public; inactive/all scopes stay ADMIN-only via
// requireAdminForInactiveScope; SUPER_ADMIN/CUSTOMER have no grant.
router.post("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), categoriesController.create);
router.patch("/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), categoriesController.update);
router.delete("/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD"), categoriesController.remove);
router.post(
  "/:id/image",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authorize("ADMIN", "HEAD", "MEMBER"),
  uploadSingleImage,
  categoriesController.uploadImage
);
router.delete("/:id/image", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), categoriesController.removeImage);

module.exports = router;
