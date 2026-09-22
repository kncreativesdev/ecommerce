import { create } from 'zustand';
import { fetchCustomerById, fetchCustomers, setCustomerActive } from '../services/customer.service.js';

export const CUSTOMER_PAGE_SIZE = 20;

const DEFAULT_FILTERS = {
  search: '',
  isActive: '',
  sortOrder: 'desc',
};

/**
 * Admin customer state (Zustand) — backend-managed ONLY.
 *
 * Filtering/sorting/pagination are SERVER-driven: the backend exposes
 * explicit list params (`page/limit/search/isActive/sortBy/sortOrder`),
 * so every filter/page change refetches. The store holds the current
 * filter set, the last page of rows, and the server `meta` pagination.
 * Lifecycle mutations (`setCustomerActive`) reconcile from the
 * authoritative server response (detail + list mirror). No URL state,
 * no totals math, no invented fields.
 */
export const useCustomerStore = create((set, get) => ({
  customers: [],
  pagination: { page: 1, limit: CUSTOMER_PAGE_SIZE, total: 0, totalPages: 1 },
  filters: { ...DEFAULT_FILTERS },
  status: 'idle',
  error: null,

  detail: null,
  detailStatus: 'idle',
  detailError: null,

  refreshCustomers: async (overrides = {}) => {
    const { filters, pagination } = get();
    const nextFilters = { ...filters, ...(overrides.filters ?? {}) };
    const page = overrides.page ?? (overrides.filters ? 1 : pagination.page);
    set({ status: 'loading', error: null, filters: nextFilters });
    try {
      const { customers, pagination: meta } = await fetchCustomers({
        page,
        limit: CUSTOMER_PAGE_SIZE,
        search: nextFilters.search || undefined,
        isActive: nextFilters.isActive === '' ? undefined : nextFilters.isActive,
        sortBy: 'createdAt',
        sortOrder: nextFilters.sortOrder || 'desc',
      });
      set({
        customers,
        pagination: {
          page: meta?.page ?? page,
          limit: meta?.limit ?? CUSTOMER_PAGE_SIZE,
          total: meta?.total ?? 0,
          totalPages: meta?.totalPages ?? 1,
        },
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load customers.', code: error?.code },
      });
    }
  },

  ensureCustomers: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    await get().refreshCustomers();
  },

  setPage: (page) => get().refreshCustomers({ page }),

  clearFilters: () => get().refreshCustomers({ filters: { ...DEFAULT_FILTERS } }),

  fetchCustomerDetail: async (id) => {
    if (!id) return null;
    set({ detailStatus: 'loading', detailError: null });
    try {
      const customer = await fetchCustomerById(id);
      set({ detail: customer, detailStatus: 'success', detailError: null });
      return customer;
    } catch (error) {
      set({
        detail: null,
        detailStatus: 'error',
        detailError: {
          message: error?.message ?? 'Failed to load the customer.',
          code: error?.code,
          status: error?.status,
        },
      });
      return null;
    }
  },

  /**
   * Reconcile a server-fresh customer after a confirmed lifecycle
   * mutation (detail + list mirror). The response is authoritative;
   * nothing is merged or recomputed client-side.
   */
  syncCustomer: (record) => {
    if (!record?.id) return;
    set((state) => {
      // Under an account-status filter a toggled row no longer matches
      // (the server would not return it) — it leaves the mirror.
      if (state.filters.isActive === 'true' && record.isActive === false) {
        return {
          detail: state.detail?.id === record.id ? record : state.detail,
          customers: state.customers.filter((item) => item.id !== record.id),
        };
      }
      if (state.filters.isActive === 'false' && record.isActive === true) {
        return {
          detail: state.detail?.id === record.id ? record : state.detail,
          customers: state.customers.filter((item) => item.id !== record.id),
        };
      }
      return {
        detail: state.detail?.id === record.id ? record : state.detail,
        customers: state.customers.some((item) => item.id === record.id)
          ? state.customers.map((item) => (item.id === record.id ? { ...item, ...record } : item))
          : state.customers,
      };
    });
  },

  setActive: async (id, isActive) => {
    const record = await setCustomerActive(id, isActive);
    if (record?.id) get().syncCustomer(record);
    return record;
  },

  clearDetail: () => set({ detail: null, detailStatus: 'idle', detailError: null }),

  clearError: () => set({ error: null }),
}));
