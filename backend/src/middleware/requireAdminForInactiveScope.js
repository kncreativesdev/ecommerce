const { authenticate } = require("./authenticate");
const { authorize } = require("./authorize");

/**
 * Conditional admin gate for read endpoints that default to active-only.
 *
 * Public clients keep working unchanged (no query param → no auth).
 * When the caller explicitly requests inactive records
 * (`?status=inactive` or `?status=all`), the request must carry an ADMIN
 * session — inactive catalog data must never leak to the storefront.
 * `?status=active` (or absent) stays public.
 */
function requireAdminForInactiveScope(req, res, next) {
  const status = req.query.status;
  if (status !== undefined && status !== "active") {
    return authenticate(req, res, (authErr) => {
      if (authErr) {
        return next(authErr);
      }
      return authorize("ADMIN")(req, res, next);
    });
  }
  return next();
}

module.exports = { requireAdminForInactiveScope };
