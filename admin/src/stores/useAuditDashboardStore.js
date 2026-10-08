import { create } from 'zustand';
import { fetchAuditSummary } from '../services/audit.service.js';

const DEFAULT_FILTERS = {
  action: '',
  resource: '',
  outcome: '',
  companyId: '',
  from: '',
  to: '',
};

/**
 * Admin audit-analytics state (Zustand) — backend-managed ONLY,
 * strictly read-only (the audit-list store pattern: server-driven
 * filtering, no URL state, no client-side slicing, no mutation
 * actions of any kind). The backend always applies an explicit
 * bounded period and the caller's visibility scope; the store
 * forwards filters and renders whatever the summary returns.
 */
function toQuery(filters) {
  const query = {};
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === 'string' && value.trim() !== '') query[key] = value.trim();
  }
  return query;
}

export const useAuditDashboardStore = create((set, get) => ({
  summary: null,
  filters: { ...DEFAULT_FILTERS },
  status: 'idle',
  error: null,

  refreshSummary: async (overrides = {}) => {
    const { filters } = get();
    const nextFilters = { ...filters, ...(overrides.filters ?? {}) };
    set({ status: 'loading', error: null, filters: nextFilters });
    try {
      const summary = await fetchAuditSummary(toQuery(nextFilters));
      set({ summary, status: 'success', error: null });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load audit analytics.', code: error?.code },
      });
    }
  },

  ensureSummary: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    await get().refreshSummary();
  },

  clearFilters: () => get().refreshSummary({ filters: { ...DEFAULT_FILTERS } }),

  clearError: () => set({ error: null }),
}));
