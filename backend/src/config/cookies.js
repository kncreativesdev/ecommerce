const { env } = require("./env");

function parseDurationToMs(value, fallbackMs) {
  if (typeof value !== "string") {
    return fallbackMs;
  }
  const match = value.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) {
    return fallbackMs;
  }
  const multipliers = { s: 1000, m: 60 * 1000, h: 3600 * 1000, d: 24 * 3600 * 1000 };
  return Number.parseInt(match[1], 10) * multipliers[match[2].toLowerCase()];
}

function getRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.refreshCookieSecure,
    sameSite: env.refreshCookieSameSite,
    path: "/",
    maxAge: parseDurationToMs(env.jwtRefreshExpiresIn, 7 * 24 * 3600 * 1000),
  };
}

function getClearRefreshCookieOptions() {
  const { maxAge, ...rest } = getRefreshCookieOptions();
  return rest;
}

module.exports = { getRefreshCookieOptions, getClearRefreshCookieOptions };
