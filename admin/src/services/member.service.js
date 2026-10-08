import { apiGet, apiGetPage, apiPatch, apiPost } from '../lib/apiClient.js';

/**
 * Team-member API access — company staff endpoints (verified:
 * `users.routes|controller|service|validation|repository`, Phase 2C-31
 * `head-member-management.test.js`). Responses use the safe user shape
 * only (`id, email, firstName, lastName, phone, isActive, roles[],
 * createdAt, updatedAt`) — never password hashes or tokens. The company
 * always derives from the authenticated server-side context: no
 * companyId is ever sent in URLs, query, body, or headers (strict
 * backend schemas reject it).
 *
 * - `GET /users` → `200 { users[] } + meta { page, limit, total,
 *   totalPages }`. Filters: `search` (email / first / last name
 *   substring), `isActive` (`"true"`/`"false"` strings), `sortBy`
 *   (`createdAt`), `sortOrder` (`asc`/`desc`). HEAD callers receive
 *   MEMBER rows only (backend-forced); ADMIN receives the unfiltered
 *   company list (the page renders staff rows only — CUSTOMER records
 *   are never presented as team members).
 * - `GET /users/:id` → `200 { user }`. HEAD resolves MEMBER targets
 *   only; anything else reads as neutral `404 USER_NOT_FOUND`.
 * - `POST /users { email, password, firstName, lastName?, phone?,
 *   role: HEAD|MEMBER }` → `201 { user }`. Role escalation is rejected
 *   (`422` for ADMIN/SUPER_ADMIN/CUSTOMER, `403 AUTH_FORBIDDEN` for
 *   HEAD→HEAD); duplicates read `409 USER_EMAIL_EXISTS`.
 * - `PATCH /users/:id/profile { firstName?, lastName?, phone? }` →
 *   `200 { user }`. MEMBER targets only, every caller; empty object →
 *   `422 USER_UPDATE_INVALID`. No email/password/role/company/isActive.
 * - `PATCH /users/:id { isActive }` → `200 { user }`. HEAD resolves
 *   MEMBER targets only (neutral 404 otherwise); self-deactivation →
 *   `409 USER_SELF_DEACTIVATION`.
 */
export function fetchMembers({
  page = 1,
  limit = 20,
  search,
  isActive,
  sortBy = 'createdAt',
  sortOrder = 'desc',
} = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('sortBy', sortBy);
  params.set('sortOrder', sortOrder);
  if (search && search.trim() !== '') params.set('search', search.trim());
  if (isActive === true || isActive === 'true') params.set('isActive', 'true');
  if (isActive === false || isActive === 'false') params.set('isActive', 'false');
  // `apiGetPage` (not `apiGet`): the list envelope carries pagination in
  // top-level `meta`, which the plain data-only helper drops.
  return apiGetPage(`/users?${params.toString()}`).then(({ data, meta }) => ({
    members: Array.isArray(data?.users) ? data.users : [],
    pagination: meta ?? { page, limit, total: 0, totalPages: 1 },
  }));
}

export function fetchMemberById(id) {
  return apiGet(`/users/${id}`).then((data) => data?.user ?? null);
}

export function createMember(payload) {
  return apiPost('/users', payload).then((data) => data?.user ?? null);
}

export function updateMemberProfile(id, payload) {
  return apiPatch(`/users/${id}/profile`, payload).then((data) => data?.user ?? null);
}

export function setMemberActive(id, isActive) {
  return apiPatch(`/users/${id}`, { isActive }).then((data) => data?.user ?? null);
}
