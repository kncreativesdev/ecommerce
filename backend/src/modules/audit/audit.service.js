const { AppError } = require("../../utils/appError");
const { ROLES, isKnownRole, hierarchyRank } = require("../../config/permissions");
const { prisma } = require("../../config/database");
const auditRepository = require("./audit.repository");
const usersRepository = require("../users/users.repository");

/**
 * Audit-log vocabulary. Actions mirror the existing domain-history
 * convention (CouponHistoryAction: CREATED/UPDATED/DEACTIVATED/
 * REACTIVATED/DELETED) so cross-cutting and domain records read alike.
 * Reserved for future phases (not emitted yet): LOGIN, LOGOUT,
 * SUSPENDED, RESTORED.
 */
const AUDIT_ACTIONS = Object.freeze([
  "CREATED",
  "UPDATED",
  "DEACTIVATED",
  "REACTIVATED",
  "DELETED",
  // Phase 2C-15 company lifecycle events (platform-attributed).
  "SUSPENDED",
  "RESTORED",
]);
const AUDIT_OUTCOMES = Object.freeze(["SUCCESS", "FAILURE"]);
// Canonical resource set. Only USER is emitted in Phase 2C-14; the rest
// name the agreed future coverage so writers share one vocabulary.
// RETURN was added in Phase 2C-17 (return-request trail);
// AUDIT_RETENTION was added in Phase 2C-19 (platform policy changes).
const AUDIT_RESOURCES = Object.freeze([
  "USER",
  "COMPANY",
  "COMPANY_DOMAIN",
  "PRODUCT",
  "PRODUCT_VARIANT",
  "CATEGORY",
  "INVENTORY",
  "ORDER",
  "COUPON",
  "REVIEW",
  "NOTIFICATION",
  "ANNOUNCEMENT",
  "MARKETING",
  "AUTH",
  "RETURN",
  "AUDIT_RETENTION",
]);

const AUDIT_DEFAULT_PAGE = 1;
const AUDIT_DEFAULT_LIMIT = 20;
const AUDIT_MAX_LIMIT = 100;
// Phase 2C-24 analytics bounds: the summary always covers an
// explicit period (default trailing 30 days) and never more than
// 366 days, so the daily-bucket output stays bounded.
const DAY_MS = 24 * 60 * 60 * 1000;
const AUDIT_SUMMARY_DEFAULT_DAYS = 30;
const AUDIT_SUMMARY_MAX_DAYS = 366;
// Phase 2C-21 export bound: one bounded window (rows + 1 probe)
// instead of pages. Large enough for operational exports, small
// enough to serialize without streaming. Requests beyond it fail
// explicitly (422 AUDIT_EXPORT_TOO_LARGE) — never silently cut.
const AUDIT_EXPORT_MAX_ROWS = 10000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/;
// Exact secret-bearing keys (case-insensitive). Values are scanned
// separately for bearer/JWT shapes, so display-adjacent names that
// merely contain these words (e.g. "tokenCount") are NOT rejected.
const SECRET_KEY_PATTERN =
  /^(password|passwd|passwordhash|secret|secrets|token|accesstoken|refreshtoken|idtoken|otp|otphash|cookie|cookies|authorization|set-cookie|apikey|api_key|privatekey|creditcard|cardnumber|cvv|ssn)$/i;
const BEARER_VALUE_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/=]{10,}/;
const JWT_VALUE_PATTERN = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$/;
const MAX_METADATA_DEPTH = 10;

function assertSafeMetadata(value, depth = 0) {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    // Scalar lists (e.g. audit `changedFields`) are expressible; every
    // element is validated like a scalar value. Nested objects/arrays
    // inside lists stay rejected so details remain shallow metadata.
    if (depth > MAX_METADATA_DEPTH) {
      throw new AppError(422, "AUDIT_INVALID_METADATA", "Audit details are nested too deeply");
    }
    for (const entry of value) {
      assertSafeScalar(entry, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new AppError(422, "AUDIT_INVALID_METADATA", "Audit details must be a JSON object");
  }
  if (depth > MAX_METADATA_DEPTH) {
    throw new AppError(422, "AUDIT_INVALID_METADATA", "Audit details are nested too deeply");
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new AppError(422, "AUDIT_UNSAFE_METADATA", "Audit details must not contain secrets");
    }
    if (typeof entry === "string") {
      assertSafeScalar(entry, depth);
    } else if (entry !== null && typeof entry === "object") {
      assertSafeMetadata(entry, depth + 1);
    }
  }
}

function assertSafeScalar(entry, depth) {
  if (typeof entry === "string") {
    if (BEARER_VALUE_PATTERN.test(entry) || JWT_VALUE_PATTERN.test(entry)) {
      throw new AppError(422, "AUDIT_UNSAFE_METADATA", "Audit details must not contain secrets");
    }
    return;
  }
  if (entry === null || entry === undefined || typeof entry === "number" || typeof entry === "boolean") {
    return;
  }
  throw new AppError(422, "AUDIT_INVALID_METADATA", "Audit details must be a JSON object");
}

function assertAuditInput(input) {
  if (!input || typeof input !== "object") {
    throw new AppError(422, "AUDIT_INVALID_EVENT", "Audit event must be an object");
  }
  const role = input.actorRole;
  const roleOk =
    (typeof role === "string" && isKnownRole(role)) || (input.actorId === null || input.actorId === undefined) && role === "SYSTEM";
  if (!roleOk) {
    throw new AppError(422, "AUDIT_INVALID_ACTOR", "Audit actor role is not recognized");
  }
  if (input.actorId !== null && input.actorId !== undefined && !UUID_PATTERN.test(input.actorId)) {
    throw new AppError(422, "AUDIT_INVALID_ACTOR", "Audit actor id is invalid");
  }
  if (input.companyId !== null && input.companyId !== undefined && !UUID_PATTERN.test(input.companyId)) {
    throw new AppError(422, "AUDIT_INVALID_EVENT", "Audit company id is invalid");
  }
  if (!AUDIT_ACTIONS.includes(input.action)) {
    throw new AppError(422, "AUDIT_INVALID_ACTION", "Audit action is not recognized");
  }
  if (!AUDIT_RESOURCES.includes(input.resource)) {
    throw new AppError(422, "AUDIT_INVALID_RESOURCE", "Audit resource is not recognized");
  }
  if (input.resourceId !== null && input.resourceId !== undefined && !UUID_PATTERN.test(input.resourceId)) {
    throw new AppError(422, "AUDIT_INVALID_EVENT", "Audit resource id is invalid");
  }
  if (!AUDIT_OUTCOMES.includes(input.outcome)) {
    throw new AppError(422, "AUDIT_INVALID_OUTCOME", "Audit outcome is not recognized");
  }
  assertSafeMetadata(input.details ?? null);
  return {
    actorId: input.actorId ?? null,
    actorRole: role,
    actorEmail: input.actorEmail ?? null,
    companyId: input.companyId ?? null,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId ?? null,
    outcome: input.outcome,
    details: input.details ?? null,
  };
}

/**
 * Server-side audit write. `client` is an optional Prisma transaction
 * client — pass the mutation's `tx` so the row commits or rolls back
 * with it; omit it for explicitly non-transactional events (recorded
 * after the mutation succeeds). Never exposed over HTTP: callers are
 * services with server-derived actor/context data.
 */
async function recordAuditEvent(input, client = null) {
  const data = assertAuditInput(input);
  return auditRepository.createAuditEvent(data, client);
}

/**
 * Builds an actor snapshot from a live user row: highest-ranked role
 * wins (permissions hierarchy), email is snapshotted. Used by
 * instrumented services so later role changes cannot rewrite history.
 */
async function resolveActorSnapshot(actorId) {
  const user = await usersRepository.findUserById(actorId);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  const names = (user.roles || []).filter((link) => link && link.role).map((link) => link.role.name);
  let top = null;
  let topRank = Number.POSITIVE_INFINITY;
  for (const name of names) {
    if (!isKnownRole(name)) {
      continue;
    }
    const rank = hierarchyRank(name);
    const effective = rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
    if (effective < topRank) {
      topRank = effective;
      top = name;
    }
  }
  return { id: user.id, role: top || ROLES.CUSTOMER, email: user.email };
}

function viewerRole(names) {
  if (names.includes(ROLES.SUPER_ADMIN)) {
    return ROLES.SUPER_ADMIN;
  }
  if (names.includes(ROLES.ADMIN)) {
    return ROLES.ADMIN;
  }
  if (names.includes(ROLES.HEAD)) {
    return ROLES.HEAD;
  }
  if (names.includes(ROLES.MEMBER)) {
    return ROLES.MEMBER;
  }
  return null;
}

function parseAuditDate(value, field) {
  if (value === undefined || value === null) {
    return null;
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new AppError(422, "VALIDATION_ERROR", `Invalid ${field} date. Use an ISO-8601 date string.`);
  }
  return new Date(time);
}

/**
 * Role-scoped audit reads (HTTP surface since Phase 2C-18 —
 * `GET /api/v1/audit-logs`; previously service-only). All scoping
 * derives from the viewer's server-side identity; client-supplied
 * actor, role, or company filters are accepted only where the
 * viewer's role permits them:
 * - MEMBER: own rows only (actor filter forced to self).
 * - HEAD: own rows plus MEMBER rows of the same company.
 * - ADMIN: every row of the same company.
 * - SUPER_ADMIN: everything, with optional server-validated
 *   company/actor filters. CUSTOMER and role-less callers: denied.
 *
 * Actor-role hierarchy (role snapshots are authoritative): rows whose
 * `actorRole` snapshot is SUPER_ADMIN are visible ONLY to SUPER_ADMIN
 * viewers — never to ADMIN/HEAD/MEMBER, even when the row's
 * `companyId` equals the viewer's company (e.g. a SUPER_ADMIN
 * provisioning a company ADMIN). Enforced database-side via
 * `excludedActorRoles` in the shared filter object.
 *
 * Cross-cutting filters (outcome/role/resourceId) apply as AND
 * predicates BESIDE the visibility scope, so they can only narrow —
 * never broaden — what each role may see (e.g. MEMBER + role=ADMIN
 * yields zero rows, not ADMIN rows).
 */
async function listAuditLogs(viewer, query = {}) {
  const { filters } = await buildAuditFilters(viewer, query);

  const page = query.page ?? AUDIT_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT);
  if (filters === null) {
    return { logs: [], pagination: { page, limit, total: 0, totalPages: 1 } };
  }
  filters.skip = (page - 1) * limit;
  filters.take = limit;

  const { rows, total } = await auditRepository.findAuditLogs(filters);
  return {
    logs: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

/**
 * Export read path (Phase 2C-21). Builds the IDENTICAL visibility
 * scope and filters as `listAuditLogs` through the shared builder
 * below — the only differences are pagination (one bounded window
 * instead of pages) and the over-limit rejection. There is exactly
 * one authorization model in this module.
 */
async function exportAuditLogs(viewer, query = {}, options = {}) {  const maxRows =
    Number.isInteger(options.maxRows) && options.maxRows > 0 ? options.maxRows : AUDIT_EXPORT_MAX_ROWS;
  const { filters } = await buildAuditFilters(viewer, query);
  if (filters === null) {
    return { logs: [], maxRows };
  }
  filters.skip = 0;
  filters.take = maxRows + 1;

  const { rows } = await auditRepository.findAuditLogs(filters);
  if (rows.length > maxRows) {
    throw new AppError(
      422,
      "AUDIT_EXPORT_TOO_LARGE",
      `Export exceeds the maximum of ${maxRows} rows. Narrow the filters and retry.`
    );
  }
  return { logs: rows, maxRows };
}

/**
 * Shared visibility + filter builder for both read paths (Phase
 * 2C-21). Role resolution, vocabulary validation, and the
 * SUPER_ADMIN/company/HEAD/MEMBER scope branches live here exactly
 * once — `listAuditLogs` and `exportAuditLogs` only differ in how
 * they page the resulting filter set. Returns `{ role, filters }`,
 * or `{ role, filters: null }` when the request is already proven
 * empty (ADMIN narrowing to a foreign/unknown actor: an empty page
 * with no existence oracle).
 */
async function buildAuditFilters(viewer, query = {}) {
  const roles = Array.isArray(viewer?.roles) ? viewer.roles : [];
  const role = viewerRole(roles);
  if (!role) {
    throw new AppError(403, "AUDIT_FORBIDDEN", "Audit log access is not permitted");
  }

  const filters = {
    from: parseAuditDate(query.from, "from"),
    to: parseAuditDate(query.to, "to"),
  };
  if (query.action !== undefined) {
    if (!AUDIT_ACTIONS.includes(query.action)) {
      throw new AppError(422, "AUDIT_INVALID_ACTION", "Audit action is not recognized");
    }
    filters.action = query.action;
  }
  if (query.resource !== undefined) {
    if (!AUDIT_RESOURCES.includes(query.resource)) {
      throw new AppError(422, "AUDIT_INVALID_RESOURCE", "Audit resource is not recognized");
    }
    filters.resource = query.resource;
  }
  if (query.outcome !== undefined) {
    if (!AUDIT_OUTCOMES.includes(query.outcome)) {
      throw new AppError(422, "AUDIT_INVALID_OUTCOME", "Audit outcome is not recognized");
    }
    filters.outcome = query.outcome;
  }
  if (query.role !== undefined) {
    if (!isKnownRole(query.role)) {
      throw new AppError(422, "AUDIT_INVALID_ACTOR", "Audit actor role is not recognized");
    }
    filters.actorRoles = [query.role];
  }
  if (query.resourceId !== undefined) {
    if (!UUID_PATTERN.test(query.resourceId)) {
      throw new AppError(422, "AUDIT_INVALID_EVENT", "Audit resource id is invalid");
    }
    filters.resourceId = query.resourceId;
  }

  if (role === ROLES.SUPER_ADMIN) {
    if (query.companyId !== undefined) {
      if (query.companyId !== null && !UUID_PATTERN.test(query.companyId)) {
        throw new AppError(422, "AUDIT_INVALID_EVENT", "Audit company id is invalid");
      }
      if (typeof query.companyId === "string" && query.companyId !== "") {
        // Unknown companies 404 (SUPER_ADMIN can already enumerate
        // companies, so no existence signal leaks beyond its reach).
        const company = await prisma.company.findUnique({
          where: { id: query.companyId },
          select: { id: true },
        });
        if (!company) {
          throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
        }
      }
      filters.companyId = query.companyId;
    }
    if (query.actorId !== undefined) {
      if (!UUID_PATTERN.test(query.actorId)) {
        throw new AppError(422, "AUDIT_INVALID_ACTOR", "Audit actor id is invalid");
      }
      filters.actorId = query.actorId;
    }
  } else {
    const companyId = viewer.companyId;
    if (typeof companyId !== "string" || companyId === "") {
      throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
    }
    filters.companyId = companyId;
    // Hierarchy gate on the actor-role snapshot (not the live User
    // row, which may change or vanish): company staff must never
    // observe SUPER_ADMIN activity, even for rows scoped to their
    // own company. Database-side via the shared builders below, so
    // list, export, and summary all inherit it identically.
    filters.excludedActorRoles = [ROLES.SUPER_ADMIN];
    if (role === ROLES.MEMBER) {
      // Actor narrowing is ignored: the scope is forced to self, so a
      // foreign actorId can never broaden it (nor signal anything —
      // the caller always sees exactly their own rows).
      filters.actorId = viewer.id;
    } else if (role === ROLES.HEAD) {
      // Same: the self+members set is fixed; a foreign actorId narrows
      // nothing and widens nothing.
      filters.or = [{ actorId: viewer.id }, { actorRole: ROLES.MEMBER }];
    } else if (role === ROLES.ADMIN && query.actorId !== undefined) {
      // ADMIN may narrow to one of their own company's actors. Unknown
      // or foreign actors yield an empty page (200, never 404) so the
      // filter cannot become a cross-company existence oracle.
      if (!UUID_PATTERN.test(query.actorId)) {
        throw new AppError(422, "AUDIT_INVALID_ACTOR", "Audit actor id is invalid");
      }
      const target = await usersRepository.findUserById(query.actorId);
      if (!target || target.companyId !== companyId) {
        return { role, filters: null };
      }
      filters.actorId = query.actorId;
    }
  }

  return { role, filters };
}

/**
 * Read-only analytics (Phase 2C-24). Reuses `buildAuditFilters`
 * verbatim — the summary aggregates EXACTLY the rows the caller
 * could list, so no total, chart, or actor count can leak outside
 * their visibility (MEMBER self-only, HEAD self+members, ADMIN
 * company, SUPER_ADMIN selected scope; SUPER_ADMIN snapshots never
 * contribute to company-staff metrics).
 *
 * Defensible metrics only (nothing inferred beyond stored columns):
 * total, per-outcome/action/resource counts, top actors by volume
 * (actorId + snapshot role — the same audience already sees both
 * in row reads), daily UTC buckets, and the latest row. Period
 * handling: `from`/`to` share the read endpoint's inclusive UTC
 * semantics; absent bounds default to the trailing 30 days;
 * spans over 366 days are rejected (bounded bucket output).
 */
async function getAuditSummary(viewer, query = {}) {
  const { filters } = await buildAuditFilters(viewer, query);
  if (filters === null) {
    const empty = emptySummary(new Date(), new Date());
    return { summary: empty };
  }

  const now = new Date();
  const to = filters.to instanceof Date ? filters.to : now;
  const from = filters.from instanceof Date ? filters.from : new Date(to.getTime() - AUDIT_SUMMARY_DEFAULT_DAYS * DAY_MS);
  if (to.getTime() - from.getTime() > AUDIT_SUMMARY_MAX_DAYS * DAY_MS) {
    throw new AppError(422, "VALIDATION_ERROR", "Audit date range must not exceed 366 days.");
  }
  filters.from = from;
  filters.to = to;

  const [counts, byDayRows, recent] = await Promise.all([
    auditRepository.getAuditSummaryCounts(filters),
    auditRepository.countAuditLogsByDay(filters),
    auditRepository.findLatestAuditLog(filters),
  ]);

  return {
    summary: {
      total: counts.total,
      period: { from: from.toISOString(), to: to.toISOString() },
      byOutcome: counts.byOutcome,
      byAction: counts.byAction,
      byResource: counts.byResource,
      topActors: counts.topActors,
      byDay: fillDayBuckets(from, to, byDayRows),
      recent,
    },
  };
}

function startOfUtcDay(time) {
  const date = new Date(time);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function toDayKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function fillDayBuckets(from, to, rows) {
  const counts = new Map(rows.map((row) => [row.day, row.count]));
  const buckets = [];
  for (let day = startOfUtcDay(from.getTime()); day <= startOfUtcDay(to.getTime()); day += DAY_MS) {
    const key = toDayKey(day);
    buckets.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return buckets;
}

function emptySummary(from, to) {
  return {
    total: 0,
    period: { from: from.toISOString(), to: to.toISOString() },
    byOutcome: [],
    byAction: [],
    byResource: [],
    topActors: [],
    byDay: fillDayBuckets(from, to, []),
    recent: null,
  };
}

module.exports = {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_RESOURCES,
  AUDIT_EXPORT_MAX_ROWS,
  assertAuditInput,
  recordAuditEvent,
  resolveActorSnapshot,
  listAuditLogs,
  exportAuditLogs,
  getAuditSummary,
};
