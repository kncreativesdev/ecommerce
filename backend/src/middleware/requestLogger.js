const pino = require("pino");
const pinoHttp = require("pino-http");

const { logger } = require("../utils/logger");

// Only the request method/URL and the response status are logged.
// Headers, cookies, authorization data and request bodies are never
// logged (see docs/SECURITY.md).
const requestLogger = pinoHttp({
  logger,
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
    err: pino.stdSerializers.err,
  },
});

module.exports = { requestLogger };
