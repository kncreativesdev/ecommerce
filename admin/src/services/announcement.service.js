import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/apiClient.js';

/**
 * Admin announcement API access — ADMIN-only `/announcements/admin*`
 * endpoints.
 *
 * - `GET /announcements/admin` → `200 { announcements[] }` (no
 *   pagination envelope — `apiGet`, not `apiGetPage`).
 * - `GET /announcements/admin/:id` → `200 { announcement }`; unknown
 *   ids → `404`.
 * - `POST /announcements/admin` → `201 { announcement }`. Writable:
 *   `message*` (1–200), `isActive?`, `startsAt?`/`expiresAt?` (ISO-8601;
 *   expiry on/after start), `linkLabel?` (1–50, nullable), `linkTarget?`
 *   (internal route starting with a single `/`, no schemes/spaces —
 *   nullable), `priority?` (int 0–1000). Strict body: unknown → `422`.
 * - `PATCH /announcements/admin/:id` → `200 { announcement }` (partial
 *   subset; activate/deactivate is `PATCH { isActive }`).
 * - `DELETE /announcements/admin/:id` → `200 { id, message }`.
 */
export function fetchAnnouncementsAdmin() {
  return apiGet('/announcements/admin').then((data) =>
    Array.isArray(data?.announcements) ? data.announcements : [],
  );
}

export function fetchAnnouncementAdmin(id) {
  return apiGet(`/announcements/admin/${id}`).then((data) => data?.announcement ?? null);
}

export function createAnnouncement(payload) {
  return apiPost('/announcements/admin', payload).then((data) => data?.announcement ?? null);
}

export function updateAnnouncement(id, payload) {
  return apiPatch(`/announcements/admin/${id}`, payload).then((data) => data?.announcement ?? null);
}

/** Activate/deactivate: documented `PATCH { isActive }` — no dedicated endpoint. */
export function setAnnouncementActive(id, isActive) {
  return updateAnnouncement(id, { isActive });
}

export function deleteAnnouncement(id) {
  return apiDelete(`/announcements/admin/${id}`).then((data) => data ?? null);
}
