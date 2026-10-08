const express = require("express");

const reviewsController = require("./reviews.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { resolveCompanyContext, resolvePublicCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

router.post("/", authenticate, resolveCompanyContext, requireActiveCompany, reviewsController.create);
router.get("/me", authenticate, resolveCompanyContext, requireActiveCompany, reviewsController.listMine);
// Public PDP listing: approved reviews only, no auth required. Declared
// before `/:id` so the literal `product` segment is never parsed as an id.
router.get("/product/:productId", resolvePublicCompanyContext, requireActiveCompany, reviewsController.listByProduct);
// Admin review access is READ-ONLY (list only): there are no admin
// approve/reject/edit/delete endpoints by design — customer reviews are
// visible without approval and admins must not mutate them. Declared
// before `/:id` so the literal `admin` segment is never parsed as a
// review id.
router.get("/admin", authenticate, resolveCompanyContext, requireActiveCompany, authorize("ADMIN"), reviewsController.listAdmin);
router.get("/:id", authenticate, resolveCompanyContext, requireActiveCompany, reviewsController.getById);
router.patch("/:id", authenticate, resolveCompanyContext, requireActiveCompany, reviewsController.update);
router.delete("/:id", authenticate, resolveCompanyContext, requireActiveCompany, reviewsController.remove);

module.exports = router;
