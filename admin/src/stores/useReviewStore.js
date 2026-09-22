import { create } from 'zustand';
import { deleteReviewAdmin, fetchReviewsAdmin, setReviewApproved } from '../services/review.service.js';

export const REVIEW_PAGE_SIZE = 20;

const DEFAULT_FILTERS = {
  search: '',
  isApproved: '',
  rating: '',
  sortOrder: 'desc',
};

/**
 * Admin review state (Zustand) — backend-managed ONLY.
 *
 * Filtering/sorting/pagination are SERVER-driven: the backend exposes
 * explicit list params
 * (`page/limit/isApproved/rating/productId/userId/search/sortBy/sortOrder`),
 * so every filter/page change refetches. The store holds the current
 * filter set, the last page of rows, and the server `meta` pagination.
 * Moderation mutations (`setApproved`, `removeReview`) reconcile from
 * the authoritative server response. No URL state, no fake moderation
 * state, no client-side status derivation — `isApproved` always comes
 * from the server.
 */
export const useReviewStore = create((set, get) => ({
  reviews: [],
  pagination: { page: 1, limit: REVIEW_PAGE_SIZE, total: 0, totalPages: 1 },
  filters: { ...DEFAULT_FILTERS },
  status: 'idle',
  error: null,

  refreshReviews: async (overrides = {}) => {
    const { filters, pagination } = get();
    const nextFilters = { ...filters, ...(overrides.filters ?? {}) };
    const page = overrides.page ?? (overrides.filters ? 1 : pagination.page);
    set({ status: 'loading', error: null, filters: nextFilters });
    try {
      const { reviews, pagination: meta } = await fetchReviewsAdmin({
        page,
        limit: REVIEW_PAGE_SIZE,
        search: nextFilters.search || undefined,
        isApproved: nextFilters.isApproved === '' ? undefined : nextFilters.isApproved,
        rating: nextFilters.rating === '' ? undefined : nextFilters.rating,
        sortBy: 'createdAt',
        sortOrder: nextFilters.sortOrder || 'desc',
      });
      set({
        reviews,
        pagination: {
          page: meta?.page ?? page,
          limit: meta?.limit ?? REVIEW_PAGE_SIZE,
          total: meta?.total ?? 0,
          totalPages: meta?.totalPages ?? 1,
        },
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load reviews.', code: error?.code },
      });
    }
  },

  ensureReviews: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    await get().refreshReviews();
  },

  setPage: (page) => get().refreshReviews({ page }),

  clearFilters: () => get().refreshReviews({ filters: { ...DEFAULT_FILTERS } }),

  /**
   * Reconcile a server-fresh review after a confirmed moderation
   * mutation. The response is authoritative; nothing is merged
   * client-side.
   */
  syncReview: (record) => {
    if (!record?.id) return;
    set((state) => ({
      reviews: state.reviews.some((item) => item.id === record.id)
        ? state.reviews.map((item) => (item.id === record.id ? { ...item, ...record } : item))
        : state.reviews,
    }));
  },

  /**
   * Drop a deleted review from the mirror (delete is server-confirmed;
   * the refresh corrects counts/pages).
   */
  dropReview: (id) => {
    if (!id) return;
    set((state) => ({ reviews: state.reviews.filter((item) => item.id !== id) }));
  },

  setApproved: async (id, isApproved) => {
    const record = await setReviewApproved(id, isApproved);
    if (record?.id) get().syncReview(record);
    return record;
  },

  removeReview: async (id) => {
    await deleteReviewAdmin(id);
    get().dropReview(id);
    await get().refreshReviews();
  },

  clearError: () => set({ error: null }),
}));
