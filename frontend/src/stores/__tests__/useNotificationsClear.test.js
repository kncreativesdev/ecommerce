import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotificationsStore } from '../useNotificationsStore.js';
import {
  fetchNotifications,
  fetchUnreadCount,
  clearNotification,
} from '../../services/notifications.service.js';
import { fetchActiveMarketing } from '../../services/marketing.service.js';

vi.mock('../../services/notifications.service.js', () => ({
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  clearNotification: vi.fn(),
}));

vi.mock('../../services/marketing.service.js', () => ({
  fetchActiveMarketing: vi.fn(),
}));

const ITEM = {
  id: 'n1',
  type: 'ORDER_STATUS',
  title: 'Order confirmed',
  message: 'Your order was confirmed.',
  orderId: 'o1',
  isRead: false,
  createdAt: '2026-09-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationsStore.getState().reset();
  fetchActiveMarketing.mockResolvedValue([]);
});

describe('notification clearing (persisted)', () => {
  it('removes the item and refreshes unread counts on success', async () => {
    fetchNotifications.mockResolvedValue([ITEM]);
    fetchUnreadCount.mockResolvedValue(1);
    await useNotificationsStore.getState().fetchAll();
    expect(useNotificationsStore.getState().items).toHaveLength(1);

    clearNotification.mockResolvedValue({ id: 'n1' });
    fetchUnreadCount.mockResolvedValue(0);
    const result = await useNotificationsStore.getState().clearNotification('n1');
    expect(result.ok).toBe(true);
    expect(clearNotification).toHaveBeenCalledWith('n1');
    expect(useNotificationsStore.getState().items).toHaveLength(0);
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
  });

  it('keeps the item when the backend fails (no false clearing)', async () => {
    useNotificationsStore.setState({ items: [ITEM], unreadCount: 1, status: 'success' });
    clearNotification.mockRejectedValue(new Error('Network error'));
    const result = await useNotificationsStore.getState().clearNotification('n1');
    expect(result.ok).toBe(false);
    expect(useNotificationsStore.getState().items).toHaveLength(1);
    expect(useNotificationsStore.getState().items[0].id).toBe('n1');
  });
});
