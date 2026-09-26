const rateLimit = require("express-rate-limit");

const { env } = require("../config/env");

// Global baseline limiter for the single-instance modular monolith.
// No endpoint-specific or auth-specific limits here; those are added
// with their respective features.
//
// `skipSuccessfulRequests: true` is deliberate, not a weakening: a single
// page load fans out ~10 successful API calls, and two tabs (storefront +
// admin) share one IP budget — counting successes turns normal hard
// refreshes into 429s on every endpoint including `/auth/login` (the
// global limiter stacks on top of the dedicated auth limiters). Abuse
// still counts: probes/fuzzing/credential-stuffing produce 4xx/5xx, and
// the dedicated login (register+login) and refresh limiters count every
// attempt regardless of outcome.
const apiRateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
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

module.exports = { apiRateLimiter };
