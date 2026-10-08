import { apiGet, apiPatch } from '../lib/apiClient.js';

/**
 * Admin retention API access — SUPER_ADMIN-only platform setting
 * (verified: backend `retention.routes|controller|service|validation`,
 * Phase 2C-19; `authenticate → context → authorize("SUPER_ADMIN")`,
 * no company-active check).
 *
 * - `GET /audit-retention` → `200 { retention: { policy,
 *   description, updatedAt, updatedBy } }` (nulls when never
 *   configured — the server default NEVER applies).
 * - `PATCH /audit-retention { policy }` → same shape plus
 *   `changed` (`false` on idempotent same-value saves, with no new
 *   audit row). The body carries the policy enum ONLY — strict
 *   backend validation rejects companyId, durations, dates, and
 *   extra fields, so none are ever sent.
 *
 * Supported policies (server-owned vocabulary, mirrored here):
 * `NEVER`, `30_DAYS`, `1_YEAR`. No numeric durations, no
 * per-company settings, no manual deletion surface.
 */
export const RETENTION_POLICIES = Object.freeze(['NEVER', '30_DAYS', '1_YEAR']);

export function fetchRetentionPolicy() {
  return apiGet('/audit-retention').then((data) => data?.retention ?? null);
}

export function updateRetentionPolicy(policy) {
  return apiPatch('/audit-retention', { policy }).then((data) => data?.retention ?? null);
}
