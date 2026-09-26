const { ZodError } = require("zod");

const { logger } = require("../utils/logger");
const { AppError } = require("../utils/appError");

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "Route not found",
    },
  });
}

function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request data",
        details: err.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }

  if (err instanceof AppError) {
    const body = {
      code: err.code,
      message: err.message,
    };
    if (err.details !== undefined) {
      body.details = err.details;
    }
    return res.status(err.statusCode).json({
      success: false,
      error: body,
    });
  }

  const statusCode = Number.isInteger(err.statusCode)
    ? err.statusCode
    : Number.isInteger(err.status)
      ? err.status
      : 500;

  if (statusCode >= 400 && statusCode < 500) {
    const message =
      err.expose !== false && typeof err.message === "string" && err.message !== ""
        ? err.message
        : "Invalid request";
    const code = typeof err.code === "string" && err.code !== "" ? err.code : "BAD_REQUEST";
    return res.status(statusCode).json({
      success: false,
      error: {
        code,
        message,
      },
    });
  }

  logger.error({ err, method: req.method, url: req.url }, "Unhandled error");

  return res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
