import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotificationsStore } from '../useNotificationsStore.js';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../services/notifications.service.js';
import { fetchActiveMarketing } from '../../services/marketing.service.js';

vi.mock('../../services/notifications.service.js', () => ({
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock('../../services/marketing.service.js', () => ({
  fetchActiveMarketing: vi.fn(),
  resolveMarketingHref: vi.fn(),
}));

const orderItem = {
  id: 'n1',
  title: 'Order confirmed',
  message: 'Your order ORD-1 has been confirmed.',
  orderId: 'order-1',
  isRead: false,
  createdAt: '2026-09-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationsStore.getState().reset();
});

describe('useNotificationsStore', () => {
  it('fetchAll loads list + authoritative count + marketing in parallel', async () => {
    fetchNotifications.mockResolvedValue([orderItem]);
    fetchUnreadCount.mockResolvedValue(2);
    fetchActiveMarketing.mockResolvedValue([{ id: 'm1', title: 'Sale' }]);

    await useNotificationsStore.getState().fetchAll();

    const state = useNotificationsStore.getState();
    expect(fetchNotifications).toHaveBeenCalledWith({ limit: 20 });
    expect(state.items).toEqual([orderItem]);
    // Badge count comes from the dedicated endpoint, not the list.
    expect(state.unreadCount).toBe(2);
    expect(state.marketingItems).toHaveLength(1);
    expect(state.status).toBe('success');
  });

  it('markRead flips the item and refreshes the authoritative count', async () => {
    fetchNotifications.mockResolvedValue([orderItem]);
    fetchUnreadCount.mockResolvedValue(2);
    fetchActiveMarketing.mockResolvedValue([]);
    await useNotificationsStore.getState().fetchAll();

    markNotificationRead.mockResolvedValue({ ...orderItem, isRead: true });
    fetchUnreadCount.mockResolvedValue(1);

    const result = await useNotificationsStore.getState().markRead('n1');

    expect(result.ok).toBe(true);
    expect(markNotificationRead).toHaveBeenCalledWith('n1');
    expect(useNotificationsStore.getState().items[0].isRead).toBe(true);
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
  });

  it('markAllRead marks every item read and zeroes the count', async () => {
    fetchNotifications.mockResolvedValue([orderItem, { ...orderItem, id: 'n2' }]);
    fetchUnreadCount.mockResolvedValue(2);
    fetchActiveMarketing.mockResolvedValue([]);
    await useNotificationsStore.getState().fetchAll();

    markAllNotificationsRead.mockResolvedValue(2);
    fetchUnreadCount.mockResolvedValue(0);

    const result = await useNotificationsStore.getState().markAllRead();

    expect(result.ok).toBe(true);
    expect(useNotificationsStore.getState().items.every((item) => item.isRead)).toBe(true);
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
  });

  it('surfaces load failures without fabricating items', async () => {
    fetchNotifications.mockRejectedValue(new Error('Network error.'));
    fetchUnreadCount.mockResolvedValue(0);
    fetchActiveMarketing.mockResolvedValue([]);

    await useNotificationsStore.getState().fetchAll();

    const state = useNotificationsStore.getState();
    expect(state.status).toBe('error');
    expect(state.items).toEqual([]);
  });
});
