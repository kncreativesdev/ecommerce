const rateLimit = require("express-rate-limit");

const { env } = require("../../config/env");

// Stricter per-endpoint limiter for auth flows (see docs/SECURITY.md §13).
// The global baseline limiter in src/middleware/rateLimiter.js still applies.
//
// Login/registration and silent refresh use SEPARATE limiter instances with
// independent budgets (same window/max from env). They must not share one
// instance: automatic `POST /auth/refresh` retries (one per 401, plus one
// bootstrap refresh per app reload, across admin + storefront tabs sharing
// an IP) would otherwise consume the manual login budget, so a burst of
// background refreshes could lock the user out of `/auth/login` with
// "Too Many Requests". Separation keeps both protections enforced without
// cross-consumption. Limits are unchanged — this is keying, not a raise.
function buildAuthRateLimiter() {
  return rateLimit({
    windowMs: env.authRateLimitWindowMs,
    limit: env.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    // Unlike the global baseline limiter, auth limiters count EVERY
    // attempt (success or failure): brute-force and credential-stuffing
    // protection must not depend on the outcome. Locked explicitly.
    skipSuccessfulRequests: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests, please try again later.",
        },
      });
    },
  });
}

// Manual credential flows: register + login share one budget.
const authLoginRateLimiter = buildAuthRateLimiter();

// Background session maintenance: refresh has its own budget so silent
// retries can never starve login (and login attempts can never starve
// refresh). Same window/max — enforced, not bypassed.
const authRefreshRateLimiter = buildAuthRateLimiter();

// Backwards-compatible alias: existing imports of `authRateLimiter` keep
// the login-budget limiter.
const authRateLimiter = authLoginRateLimiter;

module.exports = { authRateLimiter, authLoginRateLimiter, authRefreshRateLimiter };
