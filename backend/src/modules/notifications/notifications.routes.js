const express = require("express");

const notificationsController = require("./notifications.controller");
const { authenticate } = require("../../middleware/authenticate");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

// Declared before `/:id` so the literal segments are never captured.
router.get("/unread-count", authenticate, resolveCompanyContext, requireActiveCompany, notificationsController.unreadCount);
router.post("/read-all", authenticate, resolveCompanyContext, requireActiveCompany, notificationsController.markAllRead);
router.patch("/:id/read", authenticate, resolveCompanyContext, requireActiveCompany, notificationsController.markRead);
router.delete("/:id", authenticate, resolveCompanyContext, requireActiveCompany, notificationsController.clear);
router.get("/", authenticate, resolveCompanyContext, requireActiveCompany, notificationsController.list);

module.exports = router;
