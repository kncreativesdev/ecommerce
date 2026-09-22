import { apiGet, apiPatch } from '../lib/apiClient.js';

/**
 * Users API access — self profile only (API_INTEGRATION §3).
 * - `GET /users/me` → `{ user }` (safe shape).
 * - `PATCH /users/me` → non-empty subset of `{ firstName, lastName,
 *   phone }` (nullable, trimmed, min 1 when present). Empty object → `422`.
 * Email is read-only — no email-change endpoint exists.
 */
export function fetchProfile() {
  return apiGet('/users/me').then((data) => data?.user ?? data ?? null);
}

export function updateProfile({ firstName, lastName, phone }) {
  const body = {};
  if (firstName !== undefined) body.firstName = firstName?.trim() ? firstName.trim() : null;
  if (lastName !== undefined) body.lastName = lastName?.trim() ? lastName.trim() : null;
  if (phone !== undefined) body.phone = phone?.trim() ? phone.trim() : null;
  return apiPatch('/users/me', body).then((data) => data?.user ?? data ?? null);
}
