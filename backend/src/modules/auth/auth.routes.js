const express = require("express");

const authController = require("./auth.controller");
const { authLoginRateLimiter, authRefreshRateLimiter, authPasswordResetRateLimiter } = require("./auth.rateLimit");
const { authenticate } = require("../../middleware/authenticate");
const { resolveCompanyContext, resolvePublicCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

// Registration and Google sign-in resolve the public domain company
// (Phase 2C-11) so newly created CUSTOMERs inherit it server-side.
// Unregistered hosts resolve nothing and preserve legacy behavior;
// refresh/logout never carry company context.
//
// Phase 2C-26: password login and the public recovery flows
// (forgot/verify/reset) also resolve the domain company so customer
// identity is company-scoped (same email, different companies =
// different accounts). Deliberately NO requireActiveCompany here:
// suspension/inactive gating stays inside the service AFTER
// credential verification, preserving the exact password-first
// semantics (wrong password is 401 even for suspended accounts;
// correct password on a suspended company is 403). The resolver
// itself never fails and attaches nothing on unregistered hosts.
router.post("/register", authLoginRateLimiter, resolvePublicCompanyContext, requireActiveCompany, authController.register);
router.post("/login", authLoginRateLimiter, resolvePublicCompanyContext, authController.login);
// Google ID-token sign-in shares the manual-login budget (same brute-force
// surface as password login — every attempt counts, success or failure).
router.post("/google", authLoginRateLimiter, resolvePublicCompanyContext, requireActiveCompany, authController.googleSignIn);
// Refresh has its own limiter instance (independent budget): background
// silent refreshes must never consume the manual login budget.
router.post("/refresh", authRefreshRateLimiter, authController.refresh);
router.post("/logout", authController.logout);
router.get("/me", authenticate, resolveCompanyContext, requireActiveCompany, authController.me);
// Credential recovery/change (Phase 2C-16). Public email-keyed flows
// resolve the domain company for customer identity scoping (Phase
// 2C-26: the recovery target is the (company, email) row when the
// host is registered, legacy-global otherwise — never a client tenant
// selector); initiation still answers uniformly and suspension/inactive
// gating happens inside the service from the live user row. The
// authenticated change flow reuses the standard company boundary
// (identity from req.user.id only).
router.post("/forgot-password", authPasswordResetRateLimiter, resolvePublicCompanyContext, authController.forgotPassword);
router.post("/verify-reset-otp", authPasswordResetRateLimiter, resolvePublicCompanyContext, authController.verifyResetOtp);
router.post("/reset-password", authPasswordResetRateLimiter, resolvePublicCompanyContext, authController.resetPassword);
router.post(
  "/change-password/otp",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authPasswordResetRateLimiter,
  authController.requestChangeOtp
);
router.post(
  "/change-password",
  authenticate,
  resolveCompanyContext,
  requireActiveCompany,
  authPasswordResetRateLimiter,
  authController.changePassword
);

module.exports = router;
