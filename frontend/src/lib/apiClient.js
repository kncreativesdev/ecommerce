import { env } from '../config/env.js';

/**
 * Centralized fetch wrapper (native fetch only).
 *
 * Conventions (per FRONTEND_ARCHITECTURE.md §4):
 * - `baseURL = env.apiUrl` (must include `/api/v1`). No hardcoded hosts.
 * - JSON by default; `Content-Type: application/json` on writes.
 * - Bearer injection from the in-memory auth store on every request.
 * - Response envelope unwrap: `{ success: true, data }` → return `data`.
 * - Error envelope: `{ success: false, error: { code, message }, details? }`
 *   → throw typed `ApiError { status, code, message, details }`.
 * - `401` handling: single-flight silent refresh → retry original once →
 *   else clear session. Never loops, never logs tokens.
 *
 * The auth store wires itself via `setAuthHandler` (dependency inversion —
 * this module never imports the store, so no import cycle exists).
 */
export class ApiError extends Error {
  constructor({ status = 0, code = 'UNKNOWN_ERROR', message = 'Request failed.', details = [] }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Wired once by `stores/useAuthStore.js` at module load.
const authHandler = {
  getAccessToken: () => null,
  refreshAccessToken: async () => null,
  onAuthFailure: () => {},
};

export function setAuthHandler(handler) {
  if (typeof handler?.getAccessToken === 'function') {
    authHandler.getAccessToken = handler.getAccessToken;
  }
  if (typeof handler?.refreshAccessToken === 'function') {
    authHandler.refreshAccessToken = handler.refreshAccessToken;
  }
  if (typeof handler?.onAuthFailure === 'function') {
    authHandler.onAuthFailure = handler.onAuthFailure;
  }
}

function joinUrl(base, path) {
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function authHeaders(extra = {}) {
  const token = authHandler.getAccessToken();
  if (!token) return { ...extra };
  return { ...extra, Authorization: `Bearer ${token}` };
}

async function parsePayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toApiError(response, payload) {
  const error = payload?.error ?? {};
  return new ApiError({
    status: response.status,
    code: error.code ?? `HTTP_${response.status}`,
    message: error.message ?? 'Request failed.',
    details: Array.isArray(payload?.details) ? payload.details : [],
  });
}

async function doFetch(path, { method = 'GET', body, headers, credentials } = {}) {
  const base = env.apiUrl;
  if (!base) {
    throw new ApiError({ message: 'Missing VITE_API_URL configuration.' });
  }
  try {
    return await fetch(joinUrl(base, path), {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(headers),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(credentials ? { credentials } : {}),
    });
  } catch {
    throw new ApiError({ message: 'Network error. Check your connection and retry.' });
  }
}

// Single-flight refresh shared by concurrent 401s.
let refreshInflight = null;

function refreshOnce() {
  if (!refreshInflight) {
    refreshInflight = authHandler.refreshAccessToken().finally(() => {
      refreshInflight = null;
    });
  }
  return refreshInflight;
}

export async function apiRequest(path, options = {}) {
  // `skipAuthRefresh` marks the refresh call itself: a 401 there must
  // throw immediately. Without this guard the 401-handler would invoke
  // the single-flight refresh for the refresh endpoint, which awaits its
  // own inflight promise — a self-await deadlock that hangs bootstrapping
  // (protected routes stuck on the loading gate instead of redirecting).
  const { retried, skipAuthRefresh, ...fetchOptions } = options;
  const response = await doFetch(path, fetchOptions);
  const payload = await parsePayload(response);

  if (response.status !== 401) {
    if (!response.ok || payload?.success === false) {
      throw toApiError(response, payload);
    }
    return payload?.data ?? null;
  }

  // 401 → silent refresh once, then retry the original request once.
  if (retried || skipAuthRefresh) {
    if (retried) authHandler.onAuthFailure();
    throw toApiError(response, payload);
  }
  try {
    await refreshOnce();
  } catch {
    authHandler.onAuthFailure();
    throw toApiError(response, payload);
  }
  return apiRequest(path, { ...fetchOptions, retried: true });
}

/** Convenience GET for reads. */
export function apiGet(path, options) {
  return apiRequest(path, { ...options, method: 'GET' });
}

/** Convenience POST for creates. */
export function apiPost(path, body, options) {
  return apiRequest(path, { ...options, method: 'POST', body });
}

/** Convenience PATCH for partial updates. */
export function apiPatch(path, body, options) {
  return apiRequest(path, { ...options, method: 'PATCH', body });
}

/** Convenience DELETE for removals. */
export function apiDelete(path, options) {
  return apiRequest(path, { ...options, method: 'DELETE' });
}
