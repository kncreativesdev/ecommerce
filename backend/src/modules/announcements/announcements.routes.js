const express = require("express");

const announcementsController = require("./announcements.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");

const router = express.Router();

// Public storefront endpoint: safe fields only, no auth required.
router.get("/current", announcementsController.getCurrent);

// ADMIN management (declared before `/:id`).
router.get("/admin", authenticate, authorize("ADMIN"), announcementsController.listAdmin);
router.post("/admin", authenticate, authorize("ADMIN"), announcementsController.createAdmin);
router.get("/admin/:id", authenticate, authorize("ADMIN"), announcementsController.getByIdAdmin);
router.patch(
  "/admin/:id",
  authenticate,
  authorize("ADMIN"),
  announcementsController.updateAdmin
);
router.delete(
  "/admin/:id",
  authenticate,
  authorize("ADMIN"),
  announcementsController.deleteAdmin
);

module.exports = router;
