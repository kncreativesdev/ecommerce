import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../useAuthStore.js';
import { useNotificationsStore } from '../useNotificationsStore.js';
import { useAnnouncementStore } from '../useAnnouncementStore.js';

beforeEach(() => {
  useNotificationsStore.getState().reset();
  useAnnouncementStore.getState().reset();
  useAuthStore.setState({ accessToken: null, user: null, status: 'ready', lastError: null });
});

describe('auth session cleanup (per-user mirrors)', () => {
  it('clearSession resets notification + announcement state so the next login never flashes stale data', () => {
    useAuthStore.setState({ accessToken: 'token-a', user: { id: 'u-a' }, status: 'ready' });
    useNotificationsStore.setState({
      items: [{ id: 'n1', isRead: false }],
      marketingItems: [{ id: 'm1' }],
      unreadCount: 3,
      status: 'success',
      error: null,
    });
    useAnnouncementStore.setState({
      announcement: { message: 'Sale', linkLabel: null, linkTarget: null },
      status: 'success',
      error: null,
    });

    useAuthStore.getState().clearSession();

    const bell = useNotificationsStore.getState();
    expect(bell.items).toEqual([]);
    expect(bell.marketingItems).toEqual([]);
    expect(bell.unreadCount).toBe(0);
    expect(bell.status).toBe('idle');

    const bar = useAnnouncementStore.getState();
    expect(bar.announcement).toBeNull();
    expect(bar.status).toBe('idle');

    // Auth itself is de-authenticated but settled (guest state).
    expect(useAuthStore.getState().status).toBe('ready');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
