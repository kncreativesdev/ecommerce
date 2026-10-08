import { apiGet, apiGetPage, apiPatch } from '../lib/apiClient.js';

/**
 * Admin customer API access — company user endpoints (verified:
 * `users.routes|controller|service|validation`, API_CONTRACT_MATRIX §2).
 * The backend serves ADMIN (full company scope) and HEAD
 * (MEMBER-only scope); this Customers UI itself stays ADMIN-gated
 * (see `routes/router.jsx`), so HEAD callers never reach it.
 * Every query param below is backend-supported
 * (`adminUserListQuerySchema` allowlist:
 * page/limit/search/isActive/sortBy/sortOrder). No invented params.
 *
 * - `GET /users` → `200 { users[] } + meta { page, limit, total,
 *   totalPages }`. Filters: `search` (email / first / last name
 *   substring), `isActive` (`"true"`/`"false"` strings — never a coerced
 *   boolean), `sortBy` (`createdAt`), `sortOrder` (`asc`/`desc`).
 *   Defaults: page 1, limit 20 (max 100), newest first. Rows carry safe
 *   fields only (`id, email, firstName, lastName, phone, isActive,
 *   roles[], createdAt, updatedAt`) — never password hashes or tokens.
 *   Staff creation lives on `POST /users` and managed profile edits on
 *   `PATCH /users/:id/profile` (HEAD: MEMBER targets only — not used
 *   by this UI). There is deliberately NO user-deletion, password, or
 *   address endpoint, and addresses stay owner-scoped with no admin
 *   override.
 * - `GET /users/:id` → `200 { user }` (same safe shape). Unknown ids →
 *   `404 USER_NOT_FOUND`.
 * - `PATCH /users/:id { isActive }` → `200 { user }`. Deactivation blocks
 *   the account at login/refresh (`403 AUTH_ACCOUNT_INACTIVE`);
 *   reactivation restores it. Self-deactivation is rejected
 *   (`409 USER_SELF_DEACTIVATION`).
 */
export function fetchCustomers({
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
    customers: Array.isArray(data?.users) ? data.users : [],
    pagination: meta ?? { page, limit, total: 0, totalPages: 1 },
  }));
}

export function fetchCustomerById(id) {
  return apiGet(`/users/${id}`).then((data) => data?.user ?? null);
}

export function setCustomerActive(id, isActive) {
  return apiPatch(`/users/${id}`, { isActive }).then((data) => data?.user ?? null);
}
