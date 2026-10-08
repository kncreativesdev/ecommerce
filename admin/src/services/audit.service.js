import { apiDownloadCsv, apiGetPage } from '../lib/apiClient.js';

/**
 * Admin audit-log API access — READ-ONLY listing plus CSV export
 * (verified: backend `audit.routes|controller|service|validation`).
 *
 * - `GET /audit-logs` → `200 { logs[] } + meta { page, limit, total,
 *   totalPages }`. Every query param below is backend-supported
 *   (`auditListQuerySchema` allowlist:
 *   page/limit/actorId/resourceId/companyId/resource/action/outcome/
 *   role/from/to). No invented params; unknown params are stripped
 *   server-side, so none are sent.
 * - `GET /audit-logs/export` → `text/csv` with the exact safe
 *   11-field projection. Same filters EXCEPT page/limit (the export
 *   always represents the complete filtered set, bounded server-side
 *   at 10,000 rows — over-limit answers 422 AUDIT_EXPORT_TOO_LARGE).
 *   The browser CSV is the backend file verbatim: this layer never
 *   builds CSV client-side.
 *
 * Each row carries exactly: id, actorId, actorRole, actorEmail,
 * companyId, action, resource, resourceId, outcome, details,
 * createdAt. Backend visibility (MEMBER-own / HEAD-own+members /
 * ADMIN-company / SUPER_ADMIN-all) stays authoritative; the UI only
 * forwards filters.
 */
export function fetchAuditLogs({
  page = 1,
  limit = 20,
  actorId,
  resourceId,
  companyId,
  resource,
  action,
  outcome,
  role,
  from,
  to,
} = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (actorId) params.set('actorId', actorId);
  if (resourceId) params.set('resourceId', resourceId);
  if (companyId) params.set('companyId', companyId);
  if (resource) params.set('resource', resource);
  if (action) params.set('action', action);
  if (outcome) params.set('outcome', outcome);
  if (role) params.set('role', role);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  // `apiGetPage` (not `apiGet`): the list envelope carries pagination
  // in top-level `meta`, which the plain data-only helper drops.
  return apiGetPage(`/audit-logs?${params.toString()}`).then(({ data, meta }) => ({
    logs: Array.isArray(data?.logs) ? data.logs : [],
    pagination: meta ?? { page, limit, total: 0, totalPages: 1 },
  }));
}

/**
 * Admin audit analytics — READ-ONLY summary (verified: backend
 * `audit/summary` route/controller/service/repository, Phase 2C-24).
 *
 * - `GET /audit-logs/summary` → `200 { summary }` with `total`,
 *   `period { from, to }`, `byOutcome[]`, `byAction[]`,
 *   `byResource[]`, `topActors[]`, `byDay[]`, `recent|null`. Every
 *   query param below is backend-supported (same allowlist as the
 *   export endpoint: actorId/resourceId/companyId/resource/action/
 *   outcome/role/from/to). No invented params. The backend always
 *   applies an explicit bounded period (default trailing 30 days,
 *   max 366) and aggregates only rows inside the caller's
 *   visibility scope — identical authorization model to the list
 *   and export endpoints.
 */
export function fetchAuditSummary({
  actorId,
  resourceId,
  companyId,
  resource,
  action,
  outcome,
  role,
  from,
  to,
} = {}) {
  const params = new URLSearchParams();
  if (actorId) params.set('actorId', actorId);
  if (resourceId) params.set('resourceId', resourceId);
  if (companyId) params.set('companyId', companyId);
  if (resource) params.set('resource', resource);
  if (action) params.set('action', action);
  if (outcome) params.set('outcome', outcome);
  if (role) params.set('role', role);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return apiGetPage(`/audit-logs/summary${query ? `?${query}` : ''}`).then(({ data }) => data?.summary ?? null);
}

export function downloadAuditLogsCsv({
  actorId,
  resourceId,
  companyId,
  resource,
  action,
  outcome,
  role,
  from,
  to,
} = {}) {
  const params = new URLSearchParams();
  if (actorId) params.set('actorId', actorId);
  if (resourceId) params.set('resourceId', resourceId);
  if (companyId) params.set('companyId', companyId);
  if (resource) params.set('resource', resource);
  if (action) params.set('action', action);
  if (outcome) params.set('outcome', outcome);
  if (role) params.set('role', role);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return apiDownloadCsv(`/audit-logs/export${query ? `?${query}` : ''}`);
}
