const express = require("express");

const usersController = require("./users.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");

const router = express.Router();

router.get("/me", authenticate, usersController.getMe);
router.patch("/me", authenticate, usersController.updateMe);

// Admin user administration. Literal `/me` routes above win over `/:id`
// by definition order. Responses use the safe user shape only — never
// password hashes or tokens.
router.get("/", authenticate, authorize("ADMIN"), usersController.listAdmin);
router.get("/:id", authenticate, authorize("ADMIN"), usersController.getByIdAdmin);
router.patch("/:id", authenticate, authorize("ADMIN"), usersController.updateActiveAdmin);

module.exports = router;
