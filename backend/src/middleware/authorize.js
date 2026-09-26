const { AppError } = require("../utils/appError");

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError(401, "AUTH_UNAUTHORIZED", "Authentication required"));
    }
    const roles = Array.isArray(req.user.roles) ? req.user.roles : [];
    const permitted = allowedRoles.some((role) => roles.includes(role));
    if (!permitted) {
      return next(new AppError(403, "AUTH_FORBIDDEN", "Insufficient permissions"));
    }
    return next();
  };
}

module.exports = { authorize };
