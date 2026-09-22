import { create } from 'zustand';
import {
  activateCoupon,
  createCoupon,
  deactivateCoupon,
  deleteCoupon,
  fetchCoupons,
  updateCoupon,
} from '../services/coupon.service.js';

export const COUPON_PAGE_SIZE = 20;

/**
 * Admin coupon state (Zustand) — backend-managed ONLY.
 *
 * Filtering/pagination are SERVER-driven: the backend exposes explicit
 * list params (`status/search/page/limit`), so scope/search/page changes
 * refetch. The store holds the current scope + search, the last page of
 * rows, and the server `meta` pagination. No URL state (matches the
 * catalog/order pages: list state stays local). No totals math, no
 * discount computation — API responses are authoritative.
 *
 * Loading is split in two: `status: 'loading'` is the INITIAL load only
 * (no usable rows yet → the page may show a full skeleton). Once rows
 * exist, refetches set `refreshing: true` and KEEP the current rows, so
 * filter/search/page changes never tear down the list. A background
 * failure keeps the rows with `error` set (the page shows an inline
 * retry); an initial failure leaves rows empty (full error state).
 */
export const useCouponStore = create((set, get) => ({
  coupons: [],
  pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 0, totalPages: 1 },
  /** List scope: `all` (default — inactive/expired stay visible) | `active` | `inactive`. */
  scope: 'all',
  search: '',
  status: 'idle',
  /** Background list refresh in flight (rows stay visible meanwhile). */
  refreshing: false,
  error: null,

  refreshCoupons: async (overrides = {}) => {
    const { scope, search, pagination, status } = get();
    const nextScope = overrides.scope ?? scope;
    const nextSearch = overrides.search !== undefined ? overrides.search : search;
    // Scope/search edits restart at page 1; explicit page moves keep filters.
    const page = overrides.page ?? (overrides.scope !== undefined || overrides.search !== undefined ? 1 : pagination.page);
    const isBackground = status === 'success';
    if (isBackground) {
      set({ refreshing: true, error: null, scope: nextScope, search: nextSearch });
    } else {
      set({ status: 'loading', refreshing: false, error: null, scope: nextScope, search: nextSearch });
    }
    try {
      const { coupons, pagination: meta } = await fetchCoupons({
        page,
        limit: COUPON_PAGE_SIZE,
        status: nextScope,
        search: nextSearch || undefined,
      });
      const total = meta?.total ?? 0;
      if (coupons.length === 0 && page > 1 && total > 0) {
        // Page drifted past the last page (rows removed elsewhere while
        // sitting on a late page): fall back to page 1 with the current
        // rows still mounted — no empty-state flash for a non-empty list.
        return get().refreshCoupons({ page: 1 });
      }
      set({
        coupons: Array.isArray(coupons) ? coupons : [],
        pagination: {
          page: meta?.page ?? page,
          limit: meta?.limit ?? COUPON_PAGE_SIZE,
          total,
          totalPages: meta?.totalPages ?? 1,
        },
        status: 'success',
        refreshing: false,
        error: null,
      });
    } catch (error) {
      set({
        status: isBackground ? 'success' : 'error',
        refreshing: false,
        error: { message: error?.message ?? 'Failed to load coupons.', code: error?.code },
      });
    }
  },

  ensureCoupons: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    await get().refreshCoupons();
  },

  setScope: (scope) => get().refreshCoupons({ scope }),

  setSearch: (search) => get().refreshCoupons({ search }),

  setPage: (page) => get().refreshCoupons({ page }),

  clearSearch: () => get().refreshCoupons({ search: '' }),

  getCouponById: (id) => {
    if (!id) return undefined;
    return get().coupons.find((coupon) => coupon.id === id);
  },

  /** Create via the service; the server record joins the mirror. */
  createCoupon: async (payload) => {
    const record = await createCoupon(payload);
    if (record?.id) get().syncCoupon(record);
    return record;
  },

  /** Update via the service; the server record reconciles the mirror. */
  updateCoupon: async (id, payload) => {
    const record = await updateCoupon(id, payload);
    if (record?.id) get().syncCoupon(record);
    return record;
  },

  /**
   * Documented lifecycle: `PATCH { isActive }`. The returned record is
   * reconciled (leaves the mirror only when the current scope hides it).
   * A scope-drop changes list membership, so the totals are re-fetched
   * for truth (background — rows stay mounted).
   */
  deactivateCoupon: async (id) => {
    const record = await deactivateCoupon(id);
    if (record?.id) {
      const dropped = get().scope === 'active';
      get().syncCoupon(record);
      if (dropped) await get().refreshCoupons();
    }
    return record;
  },

  /**
   * Reactivate via documented `PATCH { isActive: true }`. Same
   * membership-change refresh when the row leaves the inactive scope.
   */
  activateCoupon: async (id) => {
    const record = await activateCoupon(id);
    if (record?.id) {
      const dropped = get().scope === 'inactive';
      get().syncCoupon(record);
      if (dropped) await get().refreshCoupons();
    }
    return record;
  },

  /**
   * Server-confirmed hard delete (refused with `409 COUPON_IN_USE` once
   * used). Unknown/repeat ids surface `404 COUPON_NOT_FOUND`. The list is
   * re-fetched afterwards so totals stay authoritative (the local removal
   * gives instant feedback; the refresh corrects counts/pages).
   */
  deleteCoupon: async (id) => {
    await deleteCoupon(id);
    get().removeCoupon(id);
    await get().refreshCoupons();
  },

  /** Reconcile a server-fresh record (create/update/activate/deactivate). */
  syncCoupon: (record) => {
    if (!record?.id) return;
    set((state) => {
      const exists = state.coupons.some((item) => item.id === record.id);
      // Under the `active` scope a deactivated row must leave the mirror
      // (it no longer matches); everywhere else the fresh record is kept.
      if (state.scope === 'active' && record.isActive === false) {
        return { coupons: state.coupons.filter((item) => item.id !== record.id) };
      }
      if (state.scope === 'inactive' && record.isActive === true) {
        return { coupons: state.coupons.filter((item) => item.id !== record.id) };
      }
      return {
        coupons: exists
          ? state.coupons.map((item) => (item.id === record.id ? record : item))
          : [...state.coupons, record],
      };
    });
  },

  /** Drop a deleted coupon from the mirror (delete is server-confirmed). */
  removeCoupon: (id) => {
    if (!id) return;
    set((state) => ({ coupons: state.coupons.filter((item) => item.id !== id) }));
  },

  clearError: () => set({ error: null }),
}));
