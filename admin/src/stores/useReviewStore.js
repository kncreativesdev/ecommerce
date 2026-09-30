import { create } from 'zustand';
import { fetchReviewsAdmin } from '../services/review.service.js';

export const REVIEW_PAGE_SIZE = 20;

const DEFAULT_FILTERS = {
  search: '',
  isApproved: '',
  rating: '',
  sortOrder: 'desc',
};

/**
 * Admin review state (Zustand) — backend-managed ONLY, strictly read-only.
 *
 * Filtering/sorting/pagination are SERVER-driven: the backend exposes
 * explicit list params
 * (`page/limit/isApproved/rating/productId/userId/search/sortBy/sortOrder`),
 * so every filter/page change refetches. The store holds the current
 * filter set, the last page of rows, and the server `meta` pagination.
 * There are no review mutation actions: the admin cannot approve,
 * reject, edit, delete, or change the status of a review. No URL state,
 * no fake moderation state, no client-side status derivation —
 * `isApproved` always comes from the server.
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

  clearError: () => set({ error: null }),
}));
