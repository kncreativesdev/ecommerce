import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/apiClient.js';

/**
 * Admin marketing-notification API access — ADMIN-only
 * `/marketing/notifications/admin*` endpoints.
 *
 * - `GET /marketing/notifications/admin` → `200 { notifications[] }`
 *   (no pagination envelope — `apiGet`, not `apiGetPage`).
 * - `GET /marketing/notifications/admin/:id` → `200 { notification }`;
 *   unknown ids → `404`.
 * - `POST /marketing/notifications/admin` → `201 { notification }`.
 *   Writable: `title*` (1–150), `message*` (1–1000), `type?`
 *   (`DEAL|OFFER|ANNOUNCEMENT`), `isActive?`, `startsAt?`/`expiresAt?`
 *   (ISO-8601; expiry on/after start), `linkType?`
 *   (`SHOP|CATEGORY|PRODUCT|COUPON`, nullable) + `linkValue?` (1–100,
 *   required when `linkType` is set). Strict body: unknown fields → `422`.
 * - `PATCH /marketing/notifications/admin/:id` → `200 { notification }`
 *   (partial subset; activate/deactivate is `PATCH { isActive }`).
 * - `DELETE /marketing/notifications/admin/:id` → `200 { id, message }`.
 */
export function fetchMarketingNotificationsAdmin() {
  return apiGet('/marketing/notifications/admin').then((data) =>
    Array.isArray(data?.notifications) ? data.notifications : [],
  );
}

export function fetchMarketingNotificationAdmin(id) {
  return apiGet(`/marketing/notifications/admin/${id}`).then((data) => data?.notification ?? null);
}

export function createMarketingNotification(payload) {
  return apiPost('/marketing/notifications/admin', payload).then((data) => data?.notification ?? null);
}

export function updateMarketingNotification(id, payload) {
  return apiPatch(`/marketing/notifications/admin/${id}`, payload).then((data) => data?.notification ?? null);
}

/** Activate/deactivate: documented `PATCH { isActive }` — no dedicated endpoint. */
export function setMarketingNotificationActive(id, isActive) {
  return updateMarketingNotification(id, { isActive });
}

export function deleteMarketingNotification(id) {
  return apiDelete(`/marketing/notifications/admin/${id}`).then((data) => data ?? null);
}
