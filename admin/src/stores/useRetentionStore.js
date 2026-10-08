import { create } from 'zustand';
import { toast } from 'sonner';
import { fetchRetentionPolicy, updateRetentionPolicy } from '../services/retention.service.js';

/**
 * Admin retention state (Zustand) — backend-managed ONLY.
 *
 * A single global platform setting owned by SUPER_ADMIN: the store
 * holds the server state (`policy`, `description`, `updatedAt`,
 * `updatedBy`), never fabricates it, and refreshes from the PATCH
 * response (including idempotent `changed: false` saves). No
 * per-company state, no company selector input, no client-side
 * duration math — the body sent is always exactly `{ policy }`.
 */
export const useRetentionStore = create((set, get) => ({
  retention: null,
  status: 'idle',
  error: null,
  saving: false,

  loadRetention: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      const retention = await fetchRetentionPolicy();
      set({ retention, status: 'success', error: null });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load retention policy.', code: error?.code },
      });
    }
  },

  saveRetention: async (policy) => {
    const { saving } = get();
    if (saving) return { ok: false, duplicate: true };
    set({ saving: true });
    try {
      const retention = await updateRetentionPolicy(policy);
      set({ retention, saving: false });
      if (retention?.changed === false) {
        toast.success('Retention is already set to this policy — no changes made.');
      } else {
        toast.success('Audit retention updated.');
      }
      return { ok: true, changed: retention?.changed !== false };
    } catch (error) {
      set({ saving: false });
      toast.error(error?.message ?? 'Save failed. Please try again.');
      return { ok: false };
    }
  },

  clearError: () => set({ error: null }),
}));
