const express = require("express");

const productsController = require("./products.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, resolvePublicCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");
const { requireAdminForInactiveScope } = require("../../middleware/requireAdminForInactiveScope");

const router = express.Router();

router.get("/", resolvePublicCompanyContext, requireActiveCompany, requireAdminForInactiveScope, productsController.list);
// Authenticated admin operational reads (identity company, never Host).
// Public storefront reads above stay Host-based and unchanged. The admin
// frontend must use these for company-scoped management so a Company B
// ADMIN never inherits Company A's catalog via the Host header.
// Declared before `/:id` so `admin` is never captured as an id.
router.get("/admin", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), requireAdminForInactiveScope, productsController.list);
router.get("/admin/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), requireAdminForInactiveScope, productsController.getById);
router.get("/:id", resolvePublicCompanyContext, requireActiveCompany, requireAdminForInactiveScope, productsController.getById);
// Phase 3-2 product RBAC slice (permissions.js product grants):
// POST + PATCH → ADMIN/HEAD/MEMBER (MEMBER: no `isActive` — enforced
// in-service with 403). DELETE (delete-confirm on inactive rows = hard
// DELETE action) and all variant endpoints stay ADMIN-only: variants
// are a later slice, and HEAD/MEMBER hold no product:DELETE grant.
// Reads stay public; inactive/all scopes stay ADMIN-only via
// requireAdminForInactiveScope; SUPER_ADMIN/CUSTOMER have no grant.
router.post("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), productsController.create);
router.patch("/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), productsController.update);
router.delete("/:id", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), productsController.remove);
router.post(
  "/:productId/variants",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authorize("ADMIN", "HEAD", "MEMBER"),
  productsController.createVariant
);
router.patch(
  "/:productId/variants/:variantId",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authorize("ADMIN", "HEAD", "MEMBER"),
  productsController.updateVariant
);
// Phase 3-3 variant RBAC slice: standalone create + update are the
// product CREATE/UPDATE actions on the product-sub-resource (no
// separate variant namespace in permissions.js — see products.service
// header note). MEMBER active-state writes are refused in-service
// with 403. Soft-deactivation stays ADMIN/HEAD (MEMBER holds no
// DEACTIVATE grant); DELETE route and error taxonomy unchanged.
router.delete(
  "/:productId/variants/:variantId",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authorize("ADMIN", "HEAD"),
  productsController.removeVariant
);

module.exports = router;
