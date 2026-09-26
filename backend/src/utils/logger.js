const pino = require("pino");

const { env } = require("../config/env");

const logger = pino({
  level: env.logLevel,
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "accessToken",
      "refreshToken",
      "cookie",
      "cookies",
      "authorization",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[Redacted]",
  },
});

module.exports = { logger };
