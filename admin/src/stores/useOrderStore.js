import { create } from 'zustand';
import { fetchOrderAdmin, fetchOrdersAdmin } from '../services/order.service.js';

export const ORDER_PAGE_SIZE = 20;

const DEFAULT_FILTERS = {
  status: '',
  paymentStatus: '',
  search: '',
  city: '',
  state: '',
  from: '',
  to: '',
  sortOrder: 'desc',
};

/**
 * Admin order state (Zustand) — backend-managed ONLY.
 *
 * Unlike the catalog stores, filtering/sorting/pagination are
 * SERVER-driven: the backend exposes explicit list params
 * (`page/limit/status/paymentStatus/search/from/to/sortBy/sortOrder`),
 * so every filter/page change refetches. The store holds the current
 * filter set, the last page of rows, and the server `meta` pagination.
 * No URL state (matches the catalog pages: list state stays local).
 * No totals math, no inventory writes, no payment processing — the API
 * responses are authoritative.
 */
export const useOrderStore = create((set, get) => ({
  orders: [],
  pagination: { page: 1, limit: ORDER_PAGE_SIZE, total: 0, totalPages: 1 },
  filters: { ...DEFAULT_FILTERS },
  status: 'idle',
  error: null,

  detail: null,
  detailStatus: 'idle',
  detailError: null,

  refreshOrders: async (overrides = {}) => {
    const { filters, pagination } = get();
    const nextFilters = { ...filters, ...(overrides.filters ?? {}) };
    const page = overrides.page ?? (overrides.filters ? 1 : pagination.page);
    set({ status: 'loading', error: null, filters: nextFilters });
    try {
      // Date inputs carry calendar days (`YYYY-MM-DD`); expand to full UTC
      // day bounds so `to` includes the selected day's late orders. This is
      // filter-bound shaping only — never totals or business math.
      const { orders, pagination: meta } = await fetchOrdersAdmin({
        page,
        limit: ORDER_PAGE_SIZE,
        status: nextFilters.status || undefined,
        paymentStatus: nextFilters.paymentStatus || undefined,
        search: nextFilters.search || undefined,
        city: nextFilters.city || undefined,
        state: nextFilters.state || undefined,
        from: nextFilters.from ? `${nextFilters.from}T00:00:00.000Z` : undefined,
        to: nextFilters.to ? `${nextFilters.to}T23:59:59.999Z` : undefined,
        sortBy: 'createdAt',
        sortOrder: nextFilters.sortOrder || 'desc',
      });
      set({
        orders,
        pagination: {
          page: meta?.page ?? page,
          limit: meta?.limit ?? ORDER_PAGE_SIZE,
          total: meta?.total ?? 0,
          totalPages: meta?.totalPages ?? 1,
        },
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load orders.', code: error?.code },
      });
    }
  },

  ensureOrders: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    await get().refreshOrders();
  },

  setPage: (page) => get().refreshOrders({ page }),

  clearFilters: () => get().refreshOrders({ filters: { ...DEFAULT_FILTERS } }),

  fetchOrderDetail: async (id) => {
    if (!id) return null;
    set({ detailStatus: 'loading', detailError: null });
    try {
      const order = await fetchOrderAdmin(id);
      set({ detail: order, detailStatus: 'success', detailError: null });
      return order;
    } catch (error) {
      set({
        detail: null,
        detailStatus: 'error',
        detailError: {
          message: error?.message ?? 'Failed to load the order.',
          code: error?.code,
          status: error?.status,
        },
      });
      return null;
    }
  },

  /**
   * Reconcile a server-fresh order after a confirmed mutation (detail +
   * list mirror). The response is authoritative; nothing is merged or
   * recomputed client-side.
   */
  syncOrder: (record) => {
    if (!record?.id) return;
    set((state) => ({
      detail: state.detail?.id === record.id ? record : state.detail,
      orders: state.orders.some((item) => item.id === record.id)
        ? state.orders.map((item) => (item.id === record.id ? { ...item, ...record } : item))
        : state.orders,
    }));
  },

  clearDetail: () => set({ detail: null, detailStatus: 'idle', detailError: null }),

  clearError: () => set({ error: null }),
}));
