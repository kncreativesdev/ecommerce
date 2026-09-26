import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/apiClient.js';
import {
  createMarketingNotification,
  deleteMarketingNotification,
  fetchMarketingNotificationAdmin,
  fetchMarketingNotificationsAdmin,
  setMarketingNotificationActive,
  updateMarketingNotification,
} from '../marketing.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiGetPage: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

function notificationFixture(overrides = {}) {
  return {
    id: 'm1',
    title: 'Festive Sale',
    message: 'Up to 30% off on audio.',
    type: 'OFFER',
    isActive: true,
    startsAt: null,
    expiresAt: null,
    linkType: 'SHOP',
    linkValue: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('marketing.service (admin envelope)', () => {
  it('unwraps { notifications[] } via apiGet (no pagination envelope)', async () => {
    apiGet.mockResolvedValue({ notifications: [notificationFixture()] });

    const rows = await fetchMarketingNotificationsAdmin();

    expect(apiGet).toHaveBeenCalledWith('/marketing/notifications/admin');
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Festive Sale');
  });

  it('returns [] when the envelope carries no notifications array', async () => {
    apiGet.mockResolvedValue({ notifications: null });

    await expect(fetchMarketingNotificationsAdmin()).resolves.toEqual([]);
  });

  it('fetches a single notification by id', async () => {
    apiGet.mockResolvedValue({ notification: notificationFixture() });

    const row = await fetchMarketingNotificationAdmin('m1');

    expect(apiGet).toHaveBeenCalledWith('/marketing/notifications/admin/m1');
    expect(row?.id).toBe('m1');
  });

  it('creates through the admin route', async () => {
    apiPost.mockResolvedValue({ notification: notificationFixture() });

    await createMarketingNotification({ title: 'Festive Sale', message: 'Hi' });

    expect(apiPost).toHaveBeenCalledWith(
      '/marketing/notifications/admin',
      expect.objectContaining({ title: 'Festive Sale' }),
    );
  });

  it('updates and toggles active through PATCH (no dedicated endpoint)', async () => {
    apiPatch.mockResolvedValue({ notification: notificationFixture({ isActive: false }) });

    await updateMarketingNotification('m1', { title: 'Updated' });
    expect(apiPatch).toHaveBeenCalledWith(
      '/marketing/notifications/admin/m1',
      expect.objectContaining({ title: 'Updated' }),
    );

    await setMarketingNotificationActive('m1', false);
    expect(apiPatch).toHaveBeenCalledWith(
      '/marketing/notifications/admin/m1',
      expect.objectContaining({ isActive: false }),
    );
  });

  it('deletes through the admin route', async () => {
    apiDelete.mockResolvedValue({ id: 'm1', message: 'Deleted' });

    await deleteMarketingNotification('m1');

    expect(apiDelete).toHaveBeenCalledWith('/marketing/notifications/admin/m1');
  });
});
