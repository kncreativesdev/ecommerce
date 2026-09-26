import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/apiClient.js';

/**
 * Customer notification API access (verified `notifications.controller`):
 * - `GET /notifications?limit=&unreadOnly=` (auth) → `data { notifications[] }`
 *   where item = `{ id, type, title, message, orderId, orderNumber, isRead,
 *   createdAt, readAt }`. NOTE: `apiGet` unwraps `data` and drops `meta` —
 *   counts always come from the dedicated endpoint below, never the list.
 * - `GET /notifications/unread-count` (auth) → `{ unreadCount }`
 *   (authoritative badge source).
 * - `PATCH /notifications/:id/read` (auth) → `{ notification }`.
 * - `POST /notifications/read-all` (auth) → `{ updated }`.
 * All owner-scoped (other users' ids → `404`).
 */
export function fetchNotifications({ limit, unreadOnly } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (unreadOnly != null) params.set('unreadOnly', unreadOnly ? 'true' : 'false');
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiGet(`/notifications${query}`).then((data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.notifications)) return data.notifications;
    return [];
  });
}

/** Authoritative unread count for the bell badge (never derived from the list). */
export function fetchUnreadCount() {
  return apiGet('/notifications/unread-count').then((data) => data?.unreadCount ?? 0);
}

export function markNotificationRead(id) {
  return apiPatch(`/notifications/${id}/read`).then((data) => data?.notification ?? null);
}

export function markAllNotificationsRead() {
  return apiPost('/notifications/read-all', {}).then((data) => data?.updated ?? 0);
}

export function clearNotification(id) {
  return apiDelete(`/notifications/${id}`).then(() => ({ id }));
}
