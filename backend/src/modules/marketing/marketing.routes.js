const express = require("express");

const marketingController = require("./marketing.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");

const router = express.Router();

// Customer-visible active broadcasts (authenticated; the bell is auth-only).
router.get("/active", authenticate, marketingController.listActive);

// ADMIN management (declared before `/:id`).
router.get("/admin", authenticate, authorize("ADMIN"), marketingController.listAdmin);
router.post("/admin", authenticate, authorize("ADMIN"), marketingController.createAdmin);
router.get("/admin/:id", authenticate, authorize("ADMIN"), marketingController.getByIdAdmin);
router.patch("/admin/:id", authenticate, authorize("ADMIN"), marketingController.updateAdmin);
router.delete("/admin/:id", authenticate, authorize("ADMIN"), marketingController.deleteAdmin);

module.exports = router;
