const express = require("express");

const mediaController = require("./media.controller");
const { uploadSingleImage } = require("./media.upload");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");

const router = express.Router({ mergeParams: true });

router.get("/", mediaController.list);
router.get("/:imageId", mediaController.getById);
router.post("/", authenticate, authorize("ADMIN"), uploadSingleImage, mediaController.upload);
router.patch("/:imageId", authenticate, authorize("ADMIN"), mediaController.updateMetadata);
router.delete("/:imageId", authenticate, authorize("ADMIN"), mediaController.remove);

module.exports = router;
