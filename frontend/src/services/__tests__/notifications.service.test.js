import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPatch, apiPost } from '../../lib/apiClient.js';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../notifications.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notifications.service (customer)', () => {
  it('fetches the order notification list with limit/unreadOnly params', async () => {
    const rows = [{ id: 'n1', title: 'Order confirmed', isRead: false }];
    apiGet.mockResolvedValue({ notifications: rows });

    const result = await fetchNotifications({ limit: 20, unreadOnly: true });

    expect(apiGet).toHaveBeenCalledWith('/notifications?limit=20&unreadOnly=true');
    expect(result).toEqual(rows);
  });

  it('fetches without a query string when no options are given', async () => {
    apiGet.mockResolvedValue({ notifications: [] });

    await fetchNotifications();

    expect(apiGet).toHaveBeenCalledWith('/notifications');
  });

  it('falls back to an empty list on unexpected shapes', async () => {
    apiGet.mockResolvedValue(null);

    await expect(fetchNotifications()).resolves.toEqual([]);
  });

  it('reads the authoritative unread count from the dedicated endpoint', async () => {
    apiGet.mockResolvedValue({ unreadCount: 3 });

    const result = await fetchUnreadCount();

    // Counts come from /unread-count — never list meta (dropped by apiGet).
    expect(apiGet).toHaveBeenCalledWith('/notifications/unread-count');
    expect(result).toBe(3);
  });

  it('marks a single notification read via PATCH', async () => {
    const notification = { id: 'n1', isRead: true };
    apiPatch.mockResolvedValue({ notification });

    const result = await markNotificationRead('n1');

    expect(apiPatch).toHaveBeenCalledWith('/notifications/n1/read');
    expect(result).toEqual(notification);
  });

  it('marks all notifications read via POST', async () => {
    apiPost.mockResolvedValue({ updated: 2 });

    const result = await markAllNotificationsRead();

    expect(apiPost).toHaveBeenCalledWith('/notifications/read-all', {});
    expect(result).toBe(2);
  });
});
