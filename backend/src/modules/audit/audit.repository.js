const { prisma } = require("../../config/database");

const AUDIT_LOG_SELECT = {
  id: true,
  actorId: true,
  actorRole: true,
  actorEmail: true,
  companyId: true,
  action: true,
  resource: true,
  resourceId: true,
  outcome: true,
  details: true,
  createdAt: true,
};

/**
 * Append-only write. Accepts an optional transaction client so the row
 * commits or rolls back WITH the business mutation it records — callers
 * pass their `tx`, otherwise the shared client is used. There is no
 * update or delete path by design.
 */
async function createAuditEvent(data, client = null) {
  const db = client || prisma;
  return db.auditLog.create({
    data: {
      actorId: data.actorId ?? null,
      actorRole: data.actorRole,
      actorEmail: data.actorEmail ?? null,
      companyId: data.companyId ?? null,
      action: data.action,
      resource: data.resource,
      resourceId: data.resourceId ?? null,
      outcome: data.outcome,
      details: data.details ?? null,
    },
    select: AUDIT_LOG_SELECT,
  });
}

/**
 * Visibility query builder. Every predicate is explicit — services pass
 * a normalized filter object derived from the viewer's server-side
 * identity, never raw client input. `companyId` uses presence (not
 * truthiness) so platform-only views (`companyId: null`) stay
 * expressible; omitting the key leaves the scope unbounded (reserved
 * for platform callers, enforced in the service).
 *
 * Phase 2C-24: the Prisma `where` construction lives in
 * `buildAuditWhere` so row reads and aggregate reads share it
 * exactly — aggregation can never observe rows outside the
 * caller's visibility scope. `excludedActorRoles` carries the
 * actor-role hierarchy gate (SUPER_ADMIN snapshots invisible to
 * company staff) into every consumer, including the raw-SQL
 * daily buckets via `buildAuditScopeSql`.
 */
function buildAuditWhere(filters) {
  const {
    from,
    to,
    actorId,
    actorRoles,
    excludedActorRoles,
    action,
    resource,
    resourceId,
    outcome,
    or,
  } = filters;

  const and = [];
  if (Object.prototype.hasOwnProperty.call(filters, "companyId")) {
    and.push({ companyId: filters.companyId });
  }
  if (actorId !== undefined && actorId !== null) {
    and.push({ actorId });
  }
  if (Array.isArray(actorRoles) && actorRoles.length > 0) {
    and.push({ actorRole: { in: actorRoles } });
  }
  // Hierarchy gate: rows carrying an excluded actor-role snapshot
  // (SUPER_ADMIN activity for company-staff viewers) never match,
  // regardless of company scoping. Database-side, shared by row
  // reads, counts, group-bys, and latest-row lookups alike.
  if (Array.isArray(excludedActorRoles) && excludedActorRoles.length > 0) {
    and.push({ actorRole: { notIn: excludedActorRoles } });
  }
  if (action !== undefined && action !== null) {
    and.push({ action });
  }
  if (resource !== undefined && resource !== null) {
    and.push({ resource });
  }
  if (resourceId !== undefined && resourceId !== null) {
    and.push({ resourceId });
  }
  // Phase 2C-18 outcome predicate (validated vocabulary only —
  // services reject anything else before it reaches this builder).
  if (outcome !== undefined && outcome !== null) {
    and.push({ outcome });
  }
  if (from || to) {
    const createdAt = {};
    if (from) {
      createdAt.gte = from;
    }
    if (to) {
      createdAt.lte = to;
    }
    and.push({ createdAt });
  }
  if (Array.isArray(or) && or.length > 0) {
    and.push({ OR: or });
  }

  const where = and.length > 0 ? { AND: and } : {};
  return where;
}

async function findAuditLogs(filters) {
  const { skip, take } = filters;
  const where = buildAuditWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: AUDIT_LOG_SELECT,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Phase 2C-24 analytics. Every aggregate below filters through the
 * SAME `buildAuditWhere` scope as row reads — a viewer can only ever
 * aggregate rows they could individually list, so totals, charts,
 * and actor counts cannot leak outside their visibility (MEMBER
 * sees self-only numbers, HEAD self+members, ADMIN the company,
 * SUPER_ADMIN the selected scope). All math happens in the
 * database; rows are never hydrated for summing (dashboard
 * precedent). `groupBy` covers the categorical breakdowns; the
 * daily buckets need `DATE()` truncation, which Prisma cannot
 * express — that single query is raw SQL with bound parameters
 * (dashboard precedent), translating the SAME normalized filter
 * object (never client input).
 */

function toCount(value) {
  return Number(value ?? 0);
}

function sortCountPairs(pairs) {
  return pairs.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

async function getAuditSummaryCounts(filters, topActorsTake = 10) {
  const where = buildAuditWhere(filters);
  const [total, byActionRows, byResourceRows, byOutcomeRows, byActorRows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ["action"], where, _count: { _all: true } }),
    prisma.auditLog.groupBy({ by: ["resource"], where, _count: { _all: true } }),
    prisma.auditLog.groupBy({ by: ["outcome"], where, _count: { _all: true } }),
    prisma.auditLog.groupBy({
      by: ["actorId", "actorRole"],
      where,
      _count: { _all: true },
      orderBy: [{ _count: { actorId: "desc" } }, { actorId: "asc" }],
      take: topActorsTake,
    }),
  ]);
  return {
    total,
    byAction: sortCountPairs(byActionRows.map((row) => ({ key: row.action, action: row.action, count: row._count._all }))).map(
      ({ action, count }) => ({ action, count })
    ),
    byResource: sortCountPairs(
      byResourceRows.map((row) => ({ key: row.resource, resource: row.resource, count: row._count._all }))
    ).map(({ resource, count }) => ({ resource, count })),
    byOutcome: sortCountPairs(
      byOutcomeRows.map((row) => ({ key: row.outcome, outcome: row.outcome, count: row._count._all }))
    ).map(({ outcome, count }) => ({ outcome, count })),
    topActors: byActorRows.map((row) => ({
      actorId: row.actorId,
      actorRole: row.actorRole,
      count: row._count._all,
    })),
  };
}

async function findLatestAuditLog(filters) {
  const where = buildAuditWhere(filters);
  return prisma.auditLog.findFirst({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: AUDIT_LOG_SELECT,
  });
}

// Fixed physical column names for the date-bucket query (same table
// the Prisma client above reads — never user input).
const SUMMARY_SQL_COLUMNS = Object.freeze({
  companyId: "company_id",
  actorId: "actor_id",
  actorRole: "actor_role",
  action: "action",
  resource: "resource",
  resourceId: "resource_id",
  outcome: "outcome",
});

function pushSqlEquality(conditions, params, column, value) {
  if (value === null) {
    conditions.push(`\`${column}\` IS NULL`);
    return;
  }
  conditions.push(`\`${column}\` = ?`);
  params.push(value);
}

function pushSqlIn(conditions, params, column, values) {
  conditions.push(`\`${column}\` IN (${values.map(() => "?").join(", ")})`);
  params.push(...values);
}

/**
 * Translates the SAME normalized filter object `buildAuditWhere`
 * consumes into a parameterized MySQL predicate. Only the exact
 * shapes the service emits are supported (equalities on known
 * columns, UUID/enum/date bound values, the HEAD scope OR of two
 * single-key equalities); anything else throws instead of
 * silently dropping a visibility predicate.
 */
function buildAuditScopeSql(filters) {
  const conditions = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(filters, "companyId")) {
    pushSqlEquality(conditions, params, SUMMARY_SQL_COLUMNS.companyId, filters.companyId);
  }
  if (filters.actorId !== undefined && filters.actorId !== null) {
    pushSqlEquality(conditions, params, SUMMARY_SQL_COLUMNS.actorId, filters.actorId);
  }
  if (Array.isArray(filters.actorRoles) && filters.actorRoles.length > 0) {
    pushSqlIn(conditions, params, SUMMARY_SQL_COLUMNS.actorRole, filters.actorRoles);
  }
  // Hierarchy gate, same semantics as `buildAuditWhere`: excluded
  // actor-role snapshots never match, keeping daily buckets inside
  // the caller's visibility scope. Bound values only.
  if (Array.isArray(filters.excludedActorRoles) && filters.excludedActorRoles.length > 0) {
    conditions.push(`\`${SUMMARY_SQL_COLUMNS.actorRole}\` NOT IN (${filters.excludedActorRoles.map(() => "?").join(", ")})`);
    params.push(...filters.excludedActorRoles);
  }
  for (const key of ["action", "resource", "resourceId", "outcome"]) {
    if (filters[key] !== undefined && filters[key] !== null) {
      pushSqlEquality(conditions, params, SUMMARY_SQL_COLUMNS[key], filters[key]);
    }
  }
  if (filters.from instanceof Date) {
    conditions.push("`created_at` >= ?");
    params.push(filters.from);
  }
  if (filters.to instanceof Date) {
    conditions.push("`created_at` <= ?");
    params.push(filters.to);
  }
  if (Array.isArray(filters.or) && filters.or.length > 0) {
    const branches = filters.or.map((member) => {
      const keys = Object.keys(member);
      if (keys.length !== 1 || !Object.prototype.hasOwnProperty.call(SUMMARY_SQL_COLUMNS, keys[0])) {
        throw new Error("Unsupported audit scope OR predicate for analytics");
      }
      const column = SUMMARY_SQL_COLUMNS[keys[0]];
      const value = member[keys[0]];
      if (value === null || typeof value !== "string") {
        throw new Error("Unsupported audit scope OR predicate for analytics");
      }
      params.push(value);
      return `\`${column}\` = ?`;
    });
    conditions.push(`(${branches.join(" OR ")})`);
  }

  return { sql: conditions.length > 0 ? conditions.join(" AND ") : "1 = 1", params };
}

async function countAuditLogsByDay(filters) {
  const { sql, params } = buildAuditScopeSql(filters);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT DATE_FORMAT(\`created_at\`, '%Y-%m-%d') AS \`day\`, COUNT(*) AS \`count\` FROM \`audit_logs\` WHERE ${sql} GROUP BY \`day\` ORDER BY \`day\` ASC`,
    ...params
  );
  return rows.map((row) => ({ day: String(row.day), count: toCount(row.count) }));
}

module.exports = { createAuditEvent, findAuditLogs, getAuditSummaryCounts, findLatestAuditLog, countAuditLogsByDay };
