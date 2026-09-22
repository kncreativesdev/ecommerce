import { create } from 'zustand';
import {
  adjustInventory,
  fetchInventoryList,
  initializeInventory,
} from '../services/inventory.service.js';

export const INVENTORY_PAGE_SIZE = 20;

const DEFAULT_FILTERS = {
  search: '',
  stock: '',
  active: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
};

/**
 * Admin inventory state (Zustand) — backend-managed ONLY.
 *
 * The cross-variant list is SERVER-driven: the backend exposes explicit
 * list params (`page/limit/search/stock/active/sortBy/sortOrder`), so
 * every filter/page change refetches. The store holds the current filter
 * set, the last page of rows, and the server `meta` pagination. Stock
 * mutations (initialize/adjust) reconcile from the authoritative server
 * response — local quantities are never trusted. No URL state, no
 * localStorage, no totals math.
 */
export const useInventoryStore = create((set, get) => ({
  items: [],
  pagination: { page: 1, limit: INVENTORY_PAGE_SIZE, total: 0, totalPages: 1 },
  filters: { ...DEFAULT_FILTERS },
  status: 'idle',
  error: null,

  refreshInventory: async (overrides = {}) => {
    const { filters, pagination } = get();
    const nextFilters = { ...filters, ...(overrides.filters ?? {}) };
    const page = overrides.page ?? (overrides.filters ? 1 : pagination.page);
    set({ status: 'loading', error: null, filters: nextFilters });
    try {
      const { items, pagination: meta } = await fetchInventoryList({
        page,
        limit: INVENTORY_PAGE_SIZE,
        search: nextFilters.search || undefined,
        stock: nextFilters.stock || undefined,
        active: nextFilters.active === '' ? undefined : nextFilters.active,
        sortBy: nextFilters.sortBy || 'createdAt',
        sortOrder: nextFilters.sortOrder || 'desc',
      });
      set({
        items,
        pagination: {
          page: meta?.page ?? page,
          limit: meta?.limit ?? INVENTORY_PAGE_SIZE,
          total: meta?.total ?? 0,
          totalPages: meta?.totalPages ?? 1,
        },
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load inventory.', code: error?.code },
      });
    }
  },

  ensureInventory: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    await get().refreshInventory();
  },

  setPage: (page) => get().refreshInventory({ page }),

  clearFilters: () => get().refreshInventory({ filters: { ...DEFAULT_FILTERS } }),

  /**
   * Reconcile a server-fresh stock record after a confirmed mutation.
   * The response is authoritative; nothing is merged client-side. Under
   * a stock filter the toggled row may no longer match (the server would
   * not return it) — it leaves the mirror, exactly like the coupon
   * scope rule.
   */
  syncItem: (productId, variantId, record) => {
    if (!record) return;
    set((state) => {
      const available = record.quantity - (record.reservedQuantity ?? 0);
      const stillMatches =
        (state.filters.stock !== 'in' || available > 0) &&
        (state.filters.stock !== 'out' || available <= 0);
      return {
        items: state.items.some((item) => item?.variant?.id === variantId)
          ? state.items
              .map((item) => (item?.variant?.id === variantId ? { ...item, inventory: record } : item))
              .filter((item) => item?.variant?.id !== variantId || stillMatches)
          : state.items,
      };
    });
  },

  initializeStock: async (productId, variantId, { quantity, note }) => {
    const record = await initializeInventory(productId, variantId, { quantity, note });
    if (record) get().syncItem(productId, variantId, record);
    return record;
  },

  adjustStock: async (productId, variantId, { quantity, note }) => {
    const record = await adjustInventory(productId, variantId, { quantity, note });
    if (record) get().syncItem(productId, variantId, record);
    return record;
  },

  clearError: () => set({ error: null }),
}));
