require("dotenv/config");

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseCorsOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "http://localhost:3000";
  }
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    return "http://localhost:3000";
  }
  return origins.length === 1 ? origins[0] : origins;
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

function resolveJwtSecret(name) {
  const value = process.env[name];
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (isProduction) {
    throw new Error(`${name} is not set (required in production)`);
  }
  console.warn(`[auth] ${name} is not set; using an insecure development-only fallback. Set it in .env.`);
  return `dev-only-insecure-${name.toLowerCase().replace(/_/g, "-")}`;
}

function parseSameSite(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "lax" || normalized === "strict" || normalized === "none") {
    return normalized;
  }
  return "lax";
}

function parseSecureFlag(value) {
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "true") {
      return true;
    }
    if (value.trim().toLowerCase() === "false") {
      return false;
    }
  }
  return isProduction;
}

const env = {
  nodeEnv,
  isProduction,
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  rateLimitWindowMs: parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitMax: parsePositiveInt(process.env.RATE_LIMIT_MAX, 100),
  logLevel: process.env.LOG_LEVEL || "info",
  jwtAccessSecret: resolveJwtSecret("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: resolveJwtSecret("JWT_REFRESH_SECRET"),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  refreshCookieName: process.env.REFRESH_COOKIE_NAME || "refresh_token",
  refreshCookieSameSite: parseSameSite(process.env.REFRESH_COOKIE_SAMESITE),
  refreshCookieSecure: parseSecureFlag(process.env.REFRESH_COOKIE_SECURE),
  authRateLimitWindowMs: parsePositiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  authRateLimitMax: parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, 30),
};

module.exports = { env };
