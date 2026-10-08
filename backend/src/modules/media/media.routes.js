const express = require("express");

const mediaController = require("./media.controller");
const { uploadSingleImage } = require("./media.upload");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, resolvePublicCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router({ mergeParams: true });

router.get("/", resolvePublicCompanyContext, requireActiveCompany, mediaController.list);
// Authenticated admin operational image reads (identity company, never
// Host). Public reads above stay Host-based and unchanged. Declared
// before `/:imageId` so `admin` is never captured as an image id.
router.get("/admin", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), mediaController.list);
router.get("/admin/:imageId", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), mediaController.getById);
router.get("/:imageId", resolvePublicCompanyContext, requireActiveCompany, mediaController.getById);
// Phase 3-2 product RBAC slice: upload + metadata PATCH are the product
// UPDATE action (ADMIN/HEAD/MEMBER). Hard removal (file + row delete)
// is the DELETE action — ADMIN-only, like product removal itself.
router.post("/", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), uploadSingleImage, mediaController.upload);
router.patch("/:imageId", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN", "HEAD", "MEMBER"), mediaController.updateMetadata);
router.delete("/:imageId", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), mediaController.remove);

module.exports = router;
