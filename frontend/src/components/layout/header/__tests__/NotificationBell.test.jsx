import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { NotificationBell } from '../NotificationBell.jsx';
import { useAuthStore } from '../../../../stores/useAuthStore.js';
import { useNotificationsStore } from '../../../../stores/useNotificationsStore.js';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../../../services/notifications.service.js';
import { fetchActiveMarketing } from '../../../../services/marketing.service.js';

vi.mock('../../../../services/notifications.service.js', () => ({
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock('../../../../services/marketing.service.js', () => ({
  fetchActiveMarketing: vi.fn(),
  resolveMarketingHref: (item) => {
    if (!item) return null;
    if (item.linkType === 'PRODUCT' && item.linkValue) return `/product/${item.linkValue}`;
    if (item.linkType === 'SHOP') return '/shop';
    return null;
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const orderItem = {
  id: 'n1',
  type: 'ORDER_STATUS',
  title: 'Order confirmed',
  message: 'Your order ORD-2026-000001 has been confirmed.',
  orderId: 'order-1',
  orderNumber: 'ORD-2026-000001',
  isRead: false,
  createdAt: '2026-09-01T10:00:00.000Z',
  readAt: null,
};

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationsStore.getState().reset();
  useAuthStore.setState({ accessToken: 'test-token', user: { id: 'u1' }, status: 'ready' });
  fetchNotifications.mockResolvedValue([orderItem]);
  fetchUnreadCount.mockResolvedValue(2);
  fetchActiveMarketing.mockResolvedValue([]);
  markNotificationRead.mockResolvedValue({ ...orderItem, isRead: true });
  markAllNotificationsRead.mockResolvedValue(1);
});

describe('NotificationBell', () => {
  it('shows the authoritative unread count on the bell badge', async () => {
    renderBell();

    // Badge reflects /unread-count (2), not the list length (1).
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();
  });

  it('hides the badge when the unread count is zero', async () => {
    fetchNotifications.mockResolvedValue([]);
    fetchUnreadCount.mockResolvedValue(0);
    renderBell();

    const bell = await screen.findByRole('button', { name: 'Notifications' });
    expect(bell).toBeInTheDocument();
    expect(bell.textContent).not.toMatch(/\d/);
  });

  it('compacts large unread counts to 99+ with an accurate accessible label', async () => {
    fetchUnreadCount.mockResolvedValue(137);
    renderBell();

    expect(await screen.findByText('99+')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications, 137 unread' })).toBeInTheDocument();
  });

  it('links order notifications to the order detail route and marks read on open', async () => {
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));

    const link = await screen.findByRole('link', { name: /Order confirmed/ });
    expect(link.getAttribute('href')).toBe('/account/orders/order-1');

    fetchUnreadCount.mockResolvedValue(1);
    fireEvent.click(link);
    expect(markNotificationRead).toHaveBeenCalledWith('n1');
  });

  it('marks all read and clears the badge', async () => {
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    // The authoritative count refresh after mark-all reports zero unread.
    fetchUnreadCount.mockResolvedValue(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));

    expect(markAllNotificationsRead).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('routes marketing items to their mapped destination', async () => {
    fetchActiveMarketing.mockResolvedValue([
      { id: 'm1', title: 'New drop', message: 'Check it out', linkType: 'PRODUCT', linkValue: 'prod-1' },
    ]);
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));

    const promo = await screen.findByRole('link', { name: /New drop/ });
    expect(promo.getAttribute('href')).toBe('/product/prod-1');
  });

  it('renders an honest empty state when there is nothing to show', async () => {
    fetchNotifications.mockResolvedValue([]);
    fetchUnreadCount.mockResolvedValue(0);
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));

    expect(await screen.findByText(/No notifications yet/)).toBeInTheDocument();
  });

  it('surfaces mark-read failure instead of failing silently', async () => {
    markNotificationRead.mockRejectedValue({ message: 'Network error.' });
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));

    const link = await screen.findByRole('link', { name: /Order confirmed/ });
    fireEvent.click(link);

    expect(markNotificationRead).toHaveBeenCalledWith('n1');
    // No Toaster is mounted in tests — assert the feedback call itself
    // (the async open-handler needs a tick to settle).
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network error.'));
  });
});
