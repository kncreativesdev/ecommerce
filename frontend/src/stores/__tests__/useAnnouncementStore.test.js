import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnnouncementStore } from '../useAnnouncementStore.js';
import { fetchCurrentAnnouncement } from '../../services/announcement.service.js';

vi.mock('../../services/announcement.service.js', () => ({
  fetchCurrentAnnouncement: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAnnouncementStore.getState().reset();
});

describe('useAnnouncementStore', () => {
  it('loads the active announcement once per settled state (no polling)', async () => {
    const announcement = { message: 'Festive sale is live', linkLabel: 'Shop now', linkTarget: '/shop' };
    fetchCurrentAnnouncement.mockResolvedValue(announcement);

    await useAnnouncementStore.getState().ensure();
    await useAnnouncementStore.getState().ensure();

    expect(fetchCurrentAnnouncement).toHaveBeenCalledTimes(1);
    expect(useAnnouncementStore.getState().announcement).toEqual(announcement);
    expect(useAnnouncementStore.getState().status).toBe('success');
  });

  it('settles to null announcement when none is active', async () => {
    fetchCurrentAnnouncement.mockResolvedValue(null);

    await useAnnouncementStore.getState().ensure();

    expect(useAnnouncementStore.getState().announcement).toBeNull();
    expect(useAnnouncementStore.getState().status).toBe('success');
  });

  it('hides the bar on load failure (never a hardcoded fallback)', async () => {
    fetchCurrentAnnouncement.mockRejectedValue(new Error('Network error.'));

    await useAnnouncementStore.getState().ensure();

    const state = useAnnouncementStore.getState();
    expect(state.announcement).toBeNull();
    expect(state.status).toBe('error');
  });
});
