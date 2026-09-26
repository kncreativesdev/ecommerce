import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet } from '../../lib/apiClient.js';
import { fetchCurrentAnnouncement } from '../announcement.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('announcement.service (customer)', () => {
  it('returns the active announcement from the public endpoint', async () => {
    const announcement = { message: 'Festive sale is live', linkLabel: 'Shop now', linkTarget: '/shop' };
    apiGet.mockResolvedValue({ announcement });

    const result = await fetchCurrentAnnouncement();

    expect(apiGet).toHaveBeenCalledWith('/announcements/current');
    expect(result).toEqual(announcement);
  });

  it('returns null when no announcement is active', async () => {
    apiGet.mockResolvedValue({ announcement: null });

    await expect(fetchCurrentAnnouncement()).resolves.toBeNull();
  });
});
