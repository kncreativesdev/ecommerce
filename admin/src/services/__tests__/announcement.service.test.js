import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/apiClient.js';
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncementAdmin,
  fetchAnnouncementsAdmin,
  setAnnouncementActive,
  updateAnnouncement,
} from '../announcement.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiGetPage: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

function announcementFixture(overrides = {}) {
  return {
    id: 'a1',
    message: 'Free shipping this weekend',
    isActive: true,
    startsAt: null,
    expiresAt: null,
    linkLabel: 'Shop now',
    linkTarget: '/catalog/products',
    priority: 10,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('announcement.service (admin envelope)', () => {
  it('unwraps { announcements[] } via apiGet (no pagination envelope)', async () => {
    apiGet.mockResolvedValue({ announcements: [announcementFixture()] });

    const rows = await fetchAnnouncementsAdmin();

    expect(apiGet).toHaveBeenCalledWith('/announcements/admin');
    expect(rows).toHaveLength(1);
  });

  it('returns [] when the envelope carries no announcements array', async () => {
    apiGet.mockResolvedValue({ announcements: null });

    await expect(fetchAnnouncementsAdmin()).resolves.toEqual([]);
  });

  it('fetches a single announcement by id', async () => {
    apiGet.mockResolvedValue({ announcement: announcementFixture() });

    const row = await fetchAnnouncementAdmin('a1');

    expect(apiGet).toHaveBeenCalledWith('/announcements/admin/a1');
    expect(row?.id).toBe('a1');
  });

  it('creates through the admin route', async () => {
    apiPost.mockResolvedValue({ announcement: announcementFixture() });

    await createAnnouncement({ message: 'Hello', priority: 5 });

    expect(apiPost).toHaveBeenCalledWith(
      '/announcements/admin',
      expect.objectContaining({ message: 'Hello' }),
    );
  });

  it('updates and toggles active through PATCH (no dedicated endpoint)', async () => {
    apiPatch.mockResolvedValue({ announcement: announcementFixture({ isActive: false }) });

    await updateAnnouncement('a1', { priority: 7 });
    expect(apiPatch).toHaveBeenCalledWith(
      '/announcements/admin/a1',
      expect.objectContaining({ priority: 7 }),
    );

    await setAnnouncementActive('a1', false);
    expect(apiPatch).toHaveBeenCalledWith(
      '/announcements/admin/a1',
      expect.objectContaining({ isActive: false }),
    );
  });

  it('deletes through the admin route', async () => {
    apiDelete.mockResolvedValue({ id: 'a1', message: 'Deleted' });

    await deleteAnnouncement('a1');

    expect(apiDelete).toHaveBeenCalledWith('/announcements/admin/a1');
  });
});
