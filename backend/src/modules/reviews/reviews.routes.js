const express = require("express");

const reviewsController = require("./reviews.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");

const router = express.Router();

router.post("/", authenticate, reviewsController.create);
router.get("/me", authenticate, reviewsController.listMine);
// Public PDP listing: approved reviews only, no auth required. Declared
// before `/:id` so the literal `product` segment is never parsed as an id.
router.get("/product/:productId", reviewsController.listByProduct);
// Admin moderation routes come before `/:id` so the literal `admin`
// segment is never parsed as a review id.
router.get("/admin", authenticate, authorize("ADMIN"), reviewsController.listAdmin);
router.patch("/admin/:id", authenticate, authorize("ADMIN"), reviewsController.updateApprovedAdmin);
router.delete("/admin/:id", authenticate, authorize("ADMIN"), reviewsController.removeAdmin);
router.get("/:id", authenticate, reviewsController.getById);
router.patch("/:id", authenticate, reviewsController.update);
router.delete("/:id", authenticate, reviewsController.remove);

module.exports = router;
