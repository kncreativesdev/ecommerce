const express = require("express");

const productsController = require("./products.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { requireAdminForInactiveScope } = require("../../middleware/requireAdminForInactiveScope");

const router = express.Router();

router.get("/", requireAdminForInactiveScope, productsController.list);
router.get("/:id", requireAdminForInactiveScope, productsController.getById);
router.post("/", authenticate, authorize("ADMIN"), productsController.create);
router.patch("/:id", authenticate, authorize("ADMIN"), productsController.update);
router.delete("/:id", authenticate, authorize("ADMIN"), productsController.remove);
router.post(
  "/:productId/variants",
  authenticate,
  authorize("ADMIN"),
  productsController.createVariant
);
router.patch(
  "/:productId/variants/:variantId",
  authenticate,
  authorize("ADMIN"),
  productsController.updateVariant
);
router.delete(
  "/:productId/variants/:variantId",
  authenticate,
  authorize("ADMIN"),
  productsController.removeVariant
);

module.exports = router;
