/**
 * Company-context contract + server-side resolution (Phase 0 stub,
 * Phase 2A resolver).
 *
 * Source of truth: docs/MULTI_COMPANY_SAAS.md (sections B, L, M, P.1).
 *
 * Pure helpers (`createCompanyContext`, `getCompanyContext`,
 * `isPlatformContext`, `hasClientCompanyId`) perform no I/O and are
 * safe to use anywhere. `resolveCompanyContext` is the Phase 2A
 * boundary middleware: it runs AFTER `authenticate`, resolves the
 * company server-side from the database identity relationship, and
 * attaches the structured result as `req.companyContext`.
 *
 * Invariants (see MULTI_COMPANY_SAAS.md §P.1):
 * - JWT claims are never read for company data and never changed.
 * - Client-supplied companyId (query/body/header) is never consulted.
 * - Role names come from the database, not the token, for resolution.
 * - Failures are closed (401/403) with neutral messages that never
 *   reveal whether another company's user or company exists.
 * - Suspension is exposed (`company.status`) but NOT enforced here —
 * enforcement lives in `requireActiveCompany` below (Phase 2C-13), so
 * resolution stays a pure attach-or-reject step.
 *
 * Phase 2B-2 scope: the middleware is mounted on every authenticated
 * company-scoped route immediately after `authenticate` (and before
 * `authorize` where present), plus inside
 * `requireAdminForInactiveScope` for its authenticated admin branch.
 * Public routes (no `authenticate`) never reach it. No other behavior
 * changes: downstream controllers/services are still company-unaware
 * until tenant stamping lands.
 */

const { AppError } = require("../utils/appError");
const { ROLES } = require("../config/permissions");
const authRepository = require("../modules/auth/auth.repository");
const companiesRepository = require("../modules/companies/companies.repository");

const COMPANY_CONTEXT_FIELDS = Object.freeze(["companyId", "company", "isPlatformContext", "source"]);

/**
 * Builds the per-request company context value.
 * Pure factory (no I/O) so middleware and tests share one shape:
 * - company user (identity): { companyId, company, isPlatformContext: false, source: "identity" }
 * - company user (domain): { companyId, company, isPlatformContext: false, source: "domain" }
 * - SUPER_ADMIN platform use: { companyId: null, company: null, isPlatformContext: true, source: "platform" }
 * `source` lets downstream code distinguish how the company was
 * established without re-deriving it. It is internal only and never
 * serialized into API responses by this module.
 */
function createCompanyContext({ companyId = null, company = null, isPlatformContext = false, source = null } = {}) {
  if (isPlatformContext) {
    return { companyId: null, company: null, isPlatformContext: true, source: "platform" };
  }
  if (typeof companyId !== "string" || companyId === "") {
    return { companyId: null, company: null, isPlatformContext: false, source: source || null };
  }
  return { companyId, company: company || null, isPlatformContext: false, source: source || "identity" };
}

/**
 * Pure hostname normalization for domain resolution (Phase 2C-11).
 * Returns the normalized hostname or null when unresolvable. Rules:
 * - lowercase; single trailing dot (FQDN root) removed;
 * - `host:port` accepted for local development (numeric port stripped);
 * - bracketed IPv6 with optional port accepted;
 * - rejects empty values, whitespace, paths, queries, fragments,
 *   credentials, URL schemes, bare multi-colon strings, over-long or
 *   malformed labels, and company-UUID lookalikes (a UUID is never a
 *   valid tenant selector).
 */
function normalizeHostname(value) {
  if (typeof value !== "string") {
    return null;
  }
  let host = value.trim().toLowerCase();
  if (host === "" || host.length > 253) {
    return null;
  }
  if (/[\s/?#@]/.test(host) || host.includes("://")) {
    return null;
  }
  if (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  if (host === "") {
    return null;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(host)) {
    return null;
  }
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    if (close === -1) {
      return null;
    }
    const rest = host.slice(close + 1);
    if (rest !== "" && !/^:\d{1,5}$/.test(rest)) {
      return null;
    }
    const inner = host.slice(1, close);
    if (inner === "") {
      return null;
    }
    return inner;
  }
  const parts = host.split(":");
  if (parts.length > 2) {
    return null;
  }
  if (parts.length === 2) {
    if (!/^\d{1,5}$/.test(parts[1])) {
      return null;
    }
    host = parts[0];
    if (host === "") {
      return null;
    }
  }
  const labels = host.split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63)) {
    return null;
  }
  if (labels.some((label) => !/^[a-z0-9-]+$/.test(label))) {
    return null;
  }
  if (labels.some((label) => label.startsWith("-") || label.endsWith("-"))) {
    return null;
  }
  return host;
}

/**
 * Reads the future `req.companyContext` value when present.
 * Returns null when no context has been attached (the Phase 0 default:
 * every current request has no company context).
 */
function getCompanyContext(req) {
  if (!req || typeof req !== "object" || !req.companyContext || typeof req.companyContext !== "object") {
    return null;
  }
  return req.companyContext;
}

/**
 * True only for the SUPER_ADMIN platform context
 * (companyId null + explicit platform flag).
 */
function isPlatformContext(req) {
  const context = getCompanyContext(req);
  return context !== null && context.isPlatformContext === true && context.companyId === null;
}

/**
 * Client-supplied company identifiers must never be trusted
 * (docs/MULTI_COMPANY_SAAS.md section L). This pure detector reports
 * whether the request carries one, so the future enforcement
 * middleware can ignore/reject it in a single place.
 */
function hasClientCompanyId(req) {
  if (!req || typeof req !== "object") {
    return false;
  }
  if (req.query && typeof req.query.companyId === "string" && req.query.companyId !== "") {
    return true;
  }
  if (req.body && typeof req.body.companyId === "string" && req.body.companyId !== "") {
    return true;
  }
  if (typeof req.headers === "object" && req.headers !== null) {
    const header = req.headers["x-company-id"];
    if (typeof header === "string" && header !== "") {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the request's company context from the authenticated
 * server-side identity. Intended placement: immediately after
 * `authenticate` (Phase 2B wiring). Pure passthrough contract:
 * success attaches `req.companyContext` and calls `next()` with no
 * error; every failure calls `next(AppError)` and never attaches a
 * context.
 *
 * Rules:
 * - No `req.user` (middleware used without `authenticate`) → 401.
 * - Unknown user id → 401 (generic; no existence signal).
 * - SUPER_ADMIN (database role) → platform context, always, even when
 *   the row carries a companyId. Never rejected for null companyId.
 * - Any other role with no roles at all → 403 (fail closed).
 * - ADMIN/HEAD/MEMBER/CUSTOMER with null companyId → 403
 *   AUTH_COMPANY_REQUIRED (fail closed; nothing is inferred).
 * - Non-null companyId whose Company row cannot be read → 403
 *   AUTH_COMPANY_INVALID (defensive; FKs normally prevent this).
 * - ADMIN callers additionally require
 *   `Company.adminUserId === user.id`; otherwise 403
 *   AUTH_COMPANY_INCONSISTENT. No automatic repair or reassignment.
 * - `Company.status` (ACTIVE/SUSPENDED/…) is exposed on
 *   `req.companyContext.company.status` and never blocks here.
 */
/**
 * Pure company-resolution decision over a repository record
 * (no I/O — unit-testable without a database). Returns either
 * `{ ok: true, context }` or `{ ok: false, statusCode, code, message }`.
 * See `resolveCompanyContext` for the rule documentation.
 */
function decideCompanyContext(record) {
  if (!record) {
    return { ok: false, statusCode: 401, code: "AUTH_UNAUTHORIZED", message: "Authentication required" };
  }

  const roles = Array.isArray(record.roles)
    ? record.roles.filter((link) => link && link.role).map((link) => link.role.name)
    : [];

  if (roles.includes(ROLES.SUPER_ADMIN)) {
    return { ok: true, context: createCompanyContext({ isPlatformContext: true, source: "platform" }) };
  }

  if (roles.length === 0) {
    return { ok: false, statusCode: 403, code: "AUTH_FORBIDDEN", message: "Insufficient permissions" };
  }

  if (record.companyId === null || record.companyId === undefined) {
    return {
      ok: false,
      statusCode: 403,
      code: "AUTH_COMPANY_REQUIRED",
      message: "Account is not associated with a company",
    };
  }

  const company = record.company || null;
  if (!company || company.id !== record.companyId) {
    // Defensive: foreign keys normally prevent a dangling companyId,
    // but a missing row must fail closed, never fall back elsewhere.
    return {
      ok: false,
      statusCode: 403,
      code: "AUTH_COMPANY_INVALID",
      message: "Account company association is invalid",
    };
  }

  if (roles.includes(ROLES.ADMIN) && company.adminUserId !== record.id) {
    return {
      ok: false,
      statusCode: 403,
      code: "AUTH_COMPANY_INCONSISTENT",
      message: "Account company association is invalid",
    };
  }

  return {
    ok: true,
    context: createCompanyContext({
      companyId: company.id,
      company: { id: company.id, name: company.name, status: company.status },
      source: "identity",
    }),
  };
}

async function resolveCompanyContext(req, res, next) {
  try {
    const user = req && typeof req === "object" ? req.user : undefined;
    if (!user || typeof user.id !== "string" || user.id === "") {
      return next(new AppError(401, "AUTH_UNAUTHORIZED", "Authentication required"));
    }

    const record = await authRepository.findUserWithCompanyContext(user.id);
    const decision = decideCompanyContext(record);
    if (!decision.ok) {
      return next(new AppError(decision.statusCode, decision.code, decision.message));
    }
    req.companyContext = decision.context;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Pure domain-resolution decision over a normalized hostname and the
 * repository row (no I/O — unit-testable without a database). Returns
 * `{ attached: true, context }` when an active registration resolves,
 * else `{ attached: false }`. Never fails: unresolvable hosts simply
 * yield no context so public behavior is preserved.
 */
function decidePublicCompanyContext(normalized, row) {
  if (!normalized || !row || !row.company || typeof row.company.id !== "string") {
    return { attached: false };
  }
  return {
    attached: true,
    context: createCompanyContext({
      companyId: row.company.id,
      company: { id: row.company.id, name: row.company.name, status: row.company.status },
      source: "domain",
    }),
  };
}

/**
 * Attaches a domain-resolved public company context (Phase 2C-11).
 * Intended placement: on public storefront routes and the
 * registration/OAuth entry points, WITHOUT `authenticate`.
 *
 * Rules:
 * - An existing `req.companyContext` is never overwritten
 *   (authenticated identity and platform contexts always win, even if
 *   this middleware were ever chained after them).
 * - Host comes from the `Host` header only (`req.get("host")`). The
 *   app has no trusted-proxy configuration, so `X-Forwarded-Host` is
 *   deliberately NOT consulted — production must forward the real
 *   Host at the reverse proxy (documented deployment requirement).
 * - Unresolvable, unknown, or inactive hosts attach nothing and call
 *   `next()` cleanly: public reads and localhost development keep
 *   working, with no existence oracle for unregistered domains.
 * - Suspension is exposed (`company.status`) but NOT enforced here.
 */
async function resolvePublicCompanyContext(req, res, next) {
  try {
    if (getCompanyContext(req)) {
      return next();
    }
    const raw =
      req && typeof req.get === "function"
        ? req.get("host")
        : req && req.headers && typeof req.headers.host === "string"
          ? req.headers.host
          : undefined;
    const normalized = normalizeHostname(raw);
    if (!normalized) {
      return next();
    }
    const row = await companiesRepository.findActiveDomainWithCompany(normalized);
    const decision = decidePublicCompanyContext(normalized, row);
    if (!decision.attached) {
      return next();
    }
    req.companyContext = decision.context;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Centralized suspension gate (Phase 2C-13). Mount immediately after
 * `resolveCompanyContext` / `resolvePublicCompanyContext`, before
 * `authorize` and controllers.
 *
 * - No attached context → pass through (other layers own the decision:
 *   public legacy behavior and unauthenticated flows are preserved).
 * - Platform context (SUPER_ADMIN) → pass through, never blocked.
 * - Company context with `status === "SUSPENDED"` → 403
 *   COMPANY_SUSPENDED before any operational work runs.
 * - Anything else (ACTIVE, or any non-suspended shape) → pass through.
 *
 * This is the ONLY suspension check in the request path: no service
 * duplicates it, and suspension deletes or mutates nothing — it only
 * refuses to operate. Failures use a dedicated neutral code that
 * reveals no identifiers.
 */
function requireActiveCompany(req, res, next) {
  const context = getCompanyContext(req);
  if (!context) {
    return next();
  }
  if (context.isPlatformContext === true) {
    return next();
  }
  const status = context.company && context.company.status;
  if (status === "SUSPENDED") {
    return next(
      new AppError(403, "COMPANY_SUSPENDED", "Company operations are unavailable while the company is suspended")
    );
  }
  return next();
}

module.exports = {
  COMPANY_CONTEXT_FIELDS,
  createCompanyContext,
  getCompanyContext,
  isPlatformContext,
  hasClientCompanyId,
  normalizeHostname,
  decideCompanyContext,
  resolveCompanyContext,
  decidePublicCompanyContext,
  resolvePublicCompanyContext,
  requireActiveCompany,
};
