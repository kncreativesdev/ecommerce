import { apiGet, apiPost } from '../lib/apiClient.js';

/**
 * Auth API access — documented contract only (API_INTEGRATION.md §2,
 * verified against `backend/src/modules/auth/`):
 *
 * - `POST /auth/register` (public, rate-limited) → `201 { user }` (no
 *   token). Client normalizes email (trim + lowercase), then auto-logs in.
 * - `POST /auth/login` (public, rate-limited) → `200 { user, accessToken }`
 *   + HttpOnly `refresh_token` cookie. `credentials: "include"` is REQUIRED
 *   so the browser stores the cross-origin Set-Cookie — without it the
 *   session silently dies on the next full page load (no valid refresh).
 * - `POST /auth/refresh` (cookie, no body) → `200 { accessToken }` +
 *   rotated cookie. Wired into `apiClient`'s single-flight 401 flow.
 * - `POST /auth/logout` (credentials so the cookie clears) → `200`.
 * - `GET /auth/me` (bearer) → `{ user }` for session bootstrap.
 *
 * No password-reset / email-verification endpoints exist — no such flows.
 * Services contain no React state; stores call these functions.
 */
export function registerRequest({ email, password, firstName, lastName, phone }) {
  const body = {
    email: email.trim().toLowerCase(),
    password,
    ...(firstName?.trim() ? { firstName: firstName.trim() } : {}),
    ...(lastName?.trim() ? { lastName: lastName.trim() } : {}),
    ...(phone?.trim() ? { phone: phone.trim() } : {}),
  };
  return apiPost('/auth/register', body).then((data) => data?.user ?? null);
}

export function loginRequest({ email, password }) {
  return apiPost(
    '/auth/login',
    {
      email: email.trim().toLowerCase(),
      password,
    },
    { credentials: 'include' },
  );
}

export function refreshRequest() {
  return apiPost('/auth/refresh', undefined, {
    credentials: 'include',
    // Never refresh-on-401 for the refresh call itself (deadlock guard —
    // see apiClient). Callers (bootstrap, single-flight flow) decide.
    skipAuthRefresh: true,
  }).then((data) => data?.accessToken ?? null);
}

export function logoutRequest() {
  // Always succeeds locally even if the call fails (store handles it).
  return apiPost('/auth/logout', undefined, { credentials: 'include' }).catch(() => null);
}

export function fetchCurrentUser() {
  return apiGet('/auth/me').then((data) => data?.user ?? data ?? null);
}
