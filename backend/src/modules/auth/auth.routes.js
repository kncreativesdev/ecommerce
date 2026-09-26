const express = require("express");

const authController = require("./auth.controller");
const { authLoginRateLimiter, authRefreshRateLimiter } = require("./auth.rateLimit");
const { authenticate } = require("../../middleware/authenticate");

const router = express.Router();

router.post("/register", authLoginRateLimiter, authController.register);
router.post("/login", authLoginRateLimiter, authController.login);
// Refresh has its own limiter instance (independent budget): background
// silent refreshes must never consume the manual login budget.
router.post("/refresh", authRefreshRateLimiter, authController.refresh);
router.post("/logout", authController.logout);
router.get("/me", authenticate, authController.me);

module.exports = router;
