const express = require("express");

const categoriesController = require("./categories.controller");
const { uploadSingleImage } = require("../media/media.upload");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");
const { requireAdminForInactiveScope } = require("../../middleware/requireAdminForInactiveScope");

const router = express.Router();

router.get("/", requireAdminForInactiveScope, categoriesController.list);
router.get("/:id", requireAdminForInactiveScope, categoriesController.getById);
router.post("/", authenticate, authorize("ADMIN"), categoriesController.create);
router.patch("/:id", authenticate, authorize("ADMIN"), categoriesController.update);
router.delete("/:id", authenticate, authorize("ADMIN"), categoriesController.remove);
router.post(
  "/:id/image",
  authenticate,
  authorize("ADMIN"),
  uploadSingleImage,
  categoriesController.uploadImage
);
router.delete("/:id/image", authenticate, authorize("ADMIN"), categoriesController.removeImage);

module.exports = router;
