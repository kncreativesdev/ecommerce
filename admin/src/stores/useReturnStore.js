import { create } from 'zustand';
import { fetchReturnAdmin, fetchReturnsAdmin } from '../services/return.service.js';

export const RETURN_PAGE_SIZE = 20;

const DEFAULT_FILTERS = {
  status: '',
  search: '',
};

/**
 * Admin return-request state (Zustand) — backend-managed ONLY.
 *
 * Same server-driven shape as the order store: the backend exposes
 * explicit list params (`page/limit/status/search`), so every filter/page
 * change refetches. The store holds the current filter set, the last page
 * of rows, and the server `meta` pagination. No URL state. The API
 * responses are authoritative — nothing is merged or recomputed.
 */
export const useReturnStore = create((set, get) => ({
  returns: [],
  pagination: { page: 1, limit: RETURN_PAGE_SIZE, total: 0, totalPages: 1 },
  filters: { ...DEFAULT_FILTERS },
  status: 'idle',
  error: null,

  detail: null,
  detailStatus: 'idle',
  detailError: null,

  refreshReturns: async (overrides = {}) => {
    const { filters, pagination } = get();
    const nextFilters = { ...filters, ...(overrides.filters ?? {}) };
    const page = overrides.page ?? (overrides.filters ? 1 : pagination.page);
    set({ status: 'loading', error: null, filters: nextFilters });
    try {
      const { returns, pagination: meta } = await fetchReturnsAdmin({
        page,
        limit: RETURN_PAGE_SIZE,
        status: nextFilters.status || undefined,
        search: nextFilters.search || undefined,
      });
      set({
        returns,
        pagination: {
          page: meta?.page ?? page,
          limit: meta?.limit ?? RETURN_PAGE_SIZE,
          total: meta?.total ?? 0,
          totalPages: meta?.totalPages ?? 1,
        },
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load return requests.', code: error?.code },
      });
    }
  },

  ensureReturns: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    await get().refreshReturns();
  },

  setPage: (page) => get().refreshReturns({ page }),

  clearFilters: () => get().refreshReturns({ filters: { ...DEFAULT_FILTERS } }),

  fetchReturnDetail: async (id) => {
    if (!id) return null;
    set({ detailStatus: 'loading', detailError: null });
    try {
      const returnRequest = await fetchReturnAdmin(id);
      set({ detail: returnRequest, detailStatus: 'success', detailError: null });
      return returnRequest;
    } catch (error) {
      set({
        detail: null,
        detailStatus: 'error',
        detailError: {
          message: error?.message ?? 'Failed to load the return request.',
          code: error?.code,
          status: error?.status,
        },
      });
      return null;
    }
  },

  clearDetail: () => set({ detail: null, detailStatus: 'idle', detailError: null }),

  clearError: () => set({ error: null }),
}));
