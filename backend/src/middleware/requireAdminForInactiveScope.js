const { authenticate } = require("./authenticate");
const { authorize } = require("./authorize");
const { resolveCompanyContext, requireActiveCompany } = require("./companyContext");

/**
 * Conditional admin gate for read endpoints that default to active-only.
 *
 * Public clients keep working unchanged (no query param → no auth, and
 * therefore no company resolution). When the caller explicitly requests
 * inactive records (`?status=inactive` or `?status=all`), the request
 * must carry an ADMIN session — inactive catalog data must never leak
 * to the storefront — and the boundary ordering stays
 * authenticate → companyContext → authorize.
 * `?status=active` (or absent) stays public.
 */
function requireAdminForInactiveScope(req, res, next) {
  const status = req.query.status;
  if (status !== undefined && status !== "active") {
    return authenticate(req, res, (authErr) => {
      if (authErr) {
        return next(authErr);
      }
      return resolveCompanyContext(req, res, (ctxErr) => {
        if (ctxErr) {
          return next(ctxErr);
        }
        return requireActiveCompany(req, res, (suspendedErr) => {
          if (suspendedErr) {
            return next(suspendedErr);
          }
          return authorize("ADMIN")(req, res, next);
        });
      });
    });
  }
  return next();
}

module.exports = { requireAdminForInactiveScope };
