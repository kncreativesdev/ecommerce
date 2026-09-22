import { apiGet, apiPost } from '../lib/apiClient.js';

/**
 * Auth API access — documented contract only
 * (`backend/src/modules/auth`: routes + controller + service):
 *
 * - `POST /auth/login { email, password }` (rate-limited) →
 *   `200 { user, accessToken }` + HttpOnly refresh cookie. Errors:
 *   `401 AUTH_INVALID_CREDENTIALS`, `403 AUTH_ACCOUNT_INACTIVE`, `422`, `429`.
 * - `POST /auth/refresh` (cookie, no body) → `200 { accessToken }` +
 *   rotated cookie. Handled inside `apiClient` (single-flight).
 * - `POST /auth/logout` (credentials so the cookie clears) → `200`.
 * - `GET /auth/me` (bearer) → `{ user }` with `roles[]`.
 *
 * No registration flow in admin (no self-serve admin signup exists).
 * Role elevation is never trusted client-side; `authorize("ADMIN")`
 * enforcement is server-side on every write route.
 */
export function loginRequest({ email, password }) {
  // `credentials: "include"` is REQUIRED so the browser stores the
  // cross-origin `Set-Cookie` refresh token — without it the session works
  // until reload, then the silent-refresh bootstrap 401s and signs out.
  return apiPost(
    '/auth/login',
    {
      email: email.trim().toLowerCase(),
      password,
    },
    { credentials: 'include' },
  );
}

export function logoutRequest() {
  return apiPost('/auth/logout', undefined, { credentials: 'include' }).catch(() => null);
}

export function fetchCurrentUser() {
  return apiGet('/auth/me').then((data) => data?.user ?? null);
}
