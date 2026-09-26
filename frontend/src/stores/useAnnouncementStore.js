import { create } from 'zustand';
import { fetchCurrentAnnouncement } from '../services/announcement.service.js';

/**
 * Storefront announcement state (Zustand) — public, no auth.
 *
 * - `announcement`: `{ message, linkLabel, linkTarget } | null` (`null` =
 *   no active announcement → the bar hides).
 * - `ensure()`: loads once per settled state (loading/success short-circuit,
 *   error retries on next mount). No polling — single fetch per app-load.
 */
export const useAnnouncementStore = create((set, get) => ({
  announcement: null,
  status: 'idle',
  error: null,

  ensure: async () => {
    const { status } = get();
    if (status === 'loading' || status === 'success') return;
    set({ status: 'loading', error: null });
    try {
      const announcement = await fetchCurrentAnnouncement();
      set({ announcement: announcement ?? null, status: 'success', error: null });
    } catch (error) {
      // A failed announcement fetch hides the bar — never a hardcoded fallback.
      set({ announcement: null, status: 'error', error });
    }
  },

  reset: () => set({ announcement: null, status: 'idle', error: null }),
}));
