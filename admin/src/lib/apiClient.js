import { env } from '../config/env.js';

/**
 * Centralized admin API client (native fetch only).
 *
 * Layers: Component → Hook/store → Service → (this client) → Backend.
 * - `baseURL = env.apiUrl` (must include `/api/v1`). No hardcoded hosts.
 * - JSON by default; strict envelope handling: `{ success: true, data }`
 *   → return `data`; `{ success: false, error, details? }` → `ApiError`.
 * - Authentication: bearer token injected per request from the auth store
 *   via `setAuthHandler` (dependency inversion — the client never imports
 *   the store, so no import cycle exists). Access tokens live in memory
 *   only, never in localStorage.
 * - `401` → single-flight `POST /auth/refresh` (cookie, `credentials:
 *   "include"`, no body) → retry original once → else `onUnauthorized()`
 *   (store clears the session; route guard redirects to login). Never loops.
 *
 * Backend authorization remains authoritative; frontend guards are UX
 * layering only.
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
  onUnauthorized: () => {},
};

export function setAuthHandler(handler) {
  if (typeof handler?.getAccessToken === 'function') {
    authHandler.getAccessToken = handler.getAccessToken;
  }
  if (typeof handler?.onUnauthorized === 'function') {
    authHandler.onUnauthorized = handler.onUnauthorized;
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

async function doFetch(path, { method = 'GET', body, formData = false, headers, credentials } = {}) {
  const base = env.apiUrl;
  if (!base) {
    throw new ApiError({ message: 'Missing VITE_API_URL configuration.' });
  }
  // `formData` passes a FormData body through untouched with NO explicit
  // Content-Type — the browser generates the multipart boundary itself.
  const isForm = formData === true && body !== undefined;
  try {
    return await fetch(joinUrl(base, path), {
      method,
      headers: {
        ...(!isForm && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(headers),
      },
      ...(body !== undefined ? { body: isForm ? body : JSON.stringify(body) } : {}),
      ...(credentials ? { credentials } : {}),
    });
  } catch {
    throw new ApiError({ message: 'Network error. Check your connection and retry.' });
  }
}

// Single-flight refresh shared by concurrent 401s.
let refreshInflight = null;

async function refreshAccessToken() {
  if (!refreshInflight) {
    refreshInflight = (async () => {
      const response = await doFetch('/auth/refresh', { method: 'POST', credentials: 'include' });
      const payload = await parsePayload(response);
      if (!response.ok || payload?.success === false || !payload?.data?.accessToken) {
        throw toApiError(response, payload);
      }
      return payload.data.accessToken;
    })().finally(() => {
      refreshInflight = null;
    });
  }
  return refreshInflight;
}

// Set by the auth store: persists a freshly rotated token in memory.
let tokenSink = null;

export function setTokenSink(sink) {
  tokenSink = typeof sink === 'function' ? sink : null;
}

export async function apiRequest(path, options = {}) {
  const { response, payload } = await doRequest(path, options);
  if (!response.ok || payload?.success === false) {
    throw toApiError(response, payload);
  }
  return payload?.data ?? null;
}

/**
 * Paginated GET: same semantics as `apiRequest` (envelope, 401 refresh,
 * `ApiError`), but preserves the top-level `meta` object that collection
 * endpoints return alongside `data` (`{ success, data, meta }` per
 * API.md §4). Plain `apiGet` only returns `data`, so paginated adapters
 * MUST use this helper — otherwise totals/pagination silently default.
 */
export async function apiGetPage(path, options = {}) {
  const { response, payload } = await doRequest(path, options);
  if (!response.ok || payload?.success === false) {
    throw toApiError(response, payload);
  }
  return { data: payload?.data ?? null, meta: payload?.meta ?? null };
}

async function doRequest(path, options = {}) {
  const { retried, ...fetchOptions } = options;
  const response = await doFetch(path, fetchOptions);
  const payload = await parsePayload(response);

  if (response.status !== 401) {
    return { response, payload };
  }

  // 401 → silent refresh once, then retry the original request once.
  if (retried) {
    authHandler.onUnauthorized();
    return { response, payload };
  }
  try {
    const accessToken = await refreshAccessToken();
    tokenSink?.(accessToken);
  } catch {
    authHandler.onUnauthorized();
    return { response, payload };
  }
  return doRequest(path, { ...fetchOptions, retried: true });
}

export function apiGet(path, options) {
  return apiRequest(path, { ...options, method: 'GET' });
}

export function apiPost(path, body, options) {
  return apiRequest(path, { ...options, method: 'POST', body });
}

/** Multipart POST (e.g. media upload): FormData passes through untouched. */
export function apiPostForm(path, formData, options) {
  return apiRequest(path, { ...options, method: 'POST', body: formData, formData: true });
}

export function apiPatch(path, body, options) {
  return apiRequest(path, { ...options, method: 'PATCH', body });
}

export function apiDelete(path, options) {
  return apiRequest(path, { ...options, method: 'DELETE' });
}
