const express = require("express");

const notificationsController = require("./notifications.controller");
const { authenticate } = require("../../middleware/authenticate");

const router = express.Router();

// Declared before `/:id` so the literal segments are never captured.
router.get("/unread-count", authenticate, notificationsController.unreadCount);
router.post("/read-all", authenticate, notificationsController.markAllRead);
router.patch("/:id/read", authenticate, notificationsController.markRead);
router.delete("/:id", authenticate, notificationsController.clear);
router.get("/", authenticate, notificationsController.list);

module.exports = router;
