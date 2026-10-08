const express = require("express");

const companiesController = require("./companies.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext } = require("../../middleware/companyContext");
const { uploadSingleImage } = require("../media/media.upload");
const { authPasswordResetRateLimiter } = require("../auth/auth.rateLimit");

const router = express.Router();

/**
 * Super Admin company-management boundary (Phase 2C-15).
 *
 * Chain: authenticate → companyContext → authorize(SUPER_ADMIN).
 * Deliberately NO requireActiveCompany: platform callers must manage
 * suspended companies, and SUPER_ADMIN resolves platform context
 * (never a company). ADMIN/HEAD/MEMBER/CUSTOMER are rejected by role.
 * Responses carry platform metadata and aggregate counts only — never
 * company operational rows.
 */
const superAdmin = [authenticate, resolveCompanyContext, authorize("SUPER_ADMIN")];

router.get("/", ...superAdmin, companiesController.list);
router.post("/", ...superAdmin, companiesController.create);
// Platform aggregate summary (SUPER_ADMIN dashboard). Declared before
// `/:id` so the literal `summary` segment is never captured as a
// company id. Aggregate counts only — never operational rows.
router.get("/summary", ...superAdmin, companiesController.summary);
router.get("/:id", ...superAdmin, companiesController.getById);
// Company metadata update (rename only — strict validation rejects
// lifecycle/identity fields, which move through their dedicated
// endpoints). Same platform chain (suspended companies stay
// manageable).
router.patch("/:id", ...superAdmin, companiesController.update);
// Company logo (SUPER_ADMIN platform branding). Upload reuses the
// established raster-only pipeline (multer MIME/extension gate +
// Sharp content verification + WebP output) into a company-prefixed
// branding subtree; the server stamps `logoPath` (never client input).
// Removal clears the column transactionally; both keep suspended
// companies manageable under the same platform chain.
router.post("/:id/logo", ...superAdmin, uploadSingleImage, companiesController.uploadLogo);
router.delete("/:id/logo", ...superAdmin, companiesController.removeLogo);
router.post("/:id/suspend", ...superAdmin, companiesController.suspend);
router.post("/:id/restore", ...superAdmin, companiesController.restore);
router.post("/:id/admin", ...superAdmin, companiesController.provisionAdmin);
// Permanent deletion (Phase 2C-20): SUSPENDED-only, exact-name
// confirmation, Company #1 protected. Same platform chain (no
// requireActiveCompany — suspended companies must be manageable).
router.delete("/:id", ...superAdmin, companiesController.destroy);
// Platform credential reset (Phase 2C-16): password-only rotation for
// the company's designated ADMIN. The limiter runs after authorize so
// rejected callers never consume the shared recovery budget.
router.post("/:id/admin/password", ...superAdmin, authPasswordResetRateLimiter, companiesController.resetAdminPassword);
// Domain registry management (Phase 2C-27): SUPER_ADMIN-only hostname
// → company mappings for runtime resolution. Ownership derives from
// the route company id only — strict validation rejects any
// body-supplied companyId. Same platform chain (no
// requireActiveCompany — suspended companies stay manageable, and
// suspension enforcement remains authoritative on the request path).
router.get("/:id/domains", ...superAdmin, companiesController.listDomains);
router.post("/:id/domains", ...superAdmin, companiesController.createDomain);
router.patch("/:id/domains/:domainId", ...superAdmin, companiesController.updateDomain);
router.delete("/:id/domains/:domainId", ...superAdmin, companiesController.removeDomain);
// Google sign-in allowlist (Phase 4-4): SUPER_ADMIN-only company
// setting answering whether Google ID-token authentication is
// permitted for the company's domain traffic. Ownership derives from
// the route company id only — strict validation rejects any
// body-supplied companyId. Same platform chain (no
// requireActiveCompany — suspended companies stay manageable).
router.patch("/:id/google-signin", ...superAdmin, companiesController.updateGoogleSignIn);

module.exports = router;
