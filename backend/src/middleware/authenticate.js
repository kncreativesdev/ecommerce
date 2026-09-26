const { AppError } = require("../utils/appError");
const { verifyAccessToken } = require("../utils/jwt");

function authenticate(req, res, next) {
  const header = req.headers ? req.headers.authorization : undefined;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return next(new AppError(401, "AUTH_UNAUTHORIZED", "Authentication required"));
  }

  const token = header.slice("Bearer ".length).trim();
  if (token === "") {
    return next(new AppError(401, "AUTH_UNAUTHORIZED", "Authentication required"));
  }

  const result = verifyAccessToken(token);
  if (!result.ok) {
    if (result.reason === "expired") {
      return next(new AppError(401, "AUTH_TOKEN_EXPIRED", "Access token has expired"));
    }
    return next(new AppError(401, "AUTH_TOKEN_INVALID", "Access token is invalid"));
  }

  const { sub, roles } = result.payload || {};
  if (typeof sub !== "string" || sub === "") {
    return next(new AppError(401, "AUTH_TOKEN_INVALID", "Access token is invalid"));
  }

  req.user = { id: sub, roles: Array.isArray(roles) ? roles : [] };
  return next();
}

module.exports = { authenticate };
