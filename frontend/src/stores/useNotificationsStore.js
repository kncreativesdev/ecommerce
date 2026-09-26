import { create } from 'zustand';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  clearNotification as clearNotificationApi,
} from '../services/notifications.service.js';
import { fetchActiveMarketing } from '../services/marketing.service.js';

/**
 * Customer notification center state (Zustand) — the persistent counterpart
 * to transient sonner toasts (toasts = action feedback only).
 *
 * - `items`: order notifications (newest first), `marketingItems`: active
 *   broadcasts, `unreadCount`: AUTHORITATIVE badge count from
 *   `GET /notifications/unread-count` (list `meta` is dropped by `apiGet`,
 *   so the count is always fetched via the dedicated endpoint — never
 *   derived, never fabricated).
 * - `fetchAll()`: list + unread-count + marketing in parallel. Guarded
 *   against concurrent runs; no polling, no N+1 (single fetch per
 *   dropdown-open/app-load, driven by the bell).
 * - `markRead(id)` / `markAllRead()`: persist server-side, patch `items`
 *   locally from the returned record(s), then refresh the authoritative
 *   count. Never `location.reload`.
 */
export const useNotificationsStore = create((set, get) => ({
  items: [],
  marketingItems: [],
  unreadCount: 0,
  status: 'idle',
  error: null,

  fetchAll: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      const [items, unreadCount, marketingItems] = await Promise.all([
        fetchNotifications({ limit: 20 }),
        fetchUnreadCount(),
        // A marketing outage must never hide order updates.
        fetchActiveMarketing().catch(() => []),
      ]);
      set({
        items: items ?? [],
        unreadCount: unreadCount ?? 0,
        marketingItems: marketingItems ?? [],
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({ status: 'error', error });
    }
  },

  markRead: async (id) => {
    try {
      const updated = await markNotificationRead(id);
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id ? (updated ?? { ...item, isRead: true }) : item,
        ),
      }));
      try {
        set({ unreadCount: await fetchUnreadCount() });
      } catch {
        /* Badge corrects on the next fetchAll; the item row is already read. */
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  },

  markAllRead: async () => {
    try {
      await markAllNotificationsRead();
      set((state) => ({
        items: state.items.map((item) => ({ ...item, isRead: true })),
      }));
      try {
        set({ unreadCount: await fetchUnreadCount() });
      } catch {
        set({ unreadCount: 0 });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  },

  // Persisted clearing (DELETE /notifications/:id, owner-scoped). The item
  // leaves local state ONLY after the server confirms — a backend failure
  // keeps the row and returns ok:false so the UI never pretends it cleared.
  clearNotification: async (id) => {
    try {
      await clearNotificationApi(id);
      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
      }));
      try {
        set({ unreadCount: await fetchUnreadCount() });
      } catch {
        /* Badge corrects on the next fetchAll; the list is already cleared. */
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  },

  /** Logout/de-auth cleanup — the next session refetches from scratch. */
  reset: () => set({ items: [], marketingItems: [], unreadCount: 0, status: 'idle', error: null }),

  clearError: () => set({ error: null }),
}));
