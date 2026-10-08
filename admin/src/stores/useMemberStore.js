import { create } from 'zustand';
import { fetchMemberById, fetchMembers, setMemberActive } from '../services/member.service.js';

export const MEMBER_PAGE_SIZE = 20;

const DEFAULT_FILTERS = {
  search: '',
  isActive: '',
  sortOrder: 'desc',
};

/**
 * Team-member state (Zustand) — backend-managed ONLY.
 *
 * Filtering/sorting/pagination are SERVER-driven: the backend exposes
 * explicit list params (`page/limit/search/isActive/sortBy/sortOrder`
 * on `GET /users`), so every filter/page change refetches. The store
 * holds the current filter set, the last page of rows, and the server
 * `meta` pagination. No URL state, no companyId, no totals math, no
 * invented fields. Lifecycle mutations reconcile from the authoritative
 * server response (detail + list mirror).
 */
export const useMemberStore = create((set, get) => ({
  members: [],
  pagination: { page: 1, limit: MEMBER_PAGE_SIZE, total: 0, totalPages: 1 },
  filters: { ...DEFAULT_FILTERS },
  status: 'idle',
  error: null,

  detail: null,
  detailStatus: 'idle',
  detailError: null,

  refreshMembers: async (overrides = {}) => {
    const { filters, pagination } = get();
    const nextFilters = { ...filters, ...(overrides.filters ?? {}) };
    const page = overrides.page ?? (overrides.filters ? 1 : pagination.page);
    set({ status: 'loading', error: null, filters: nextFilters });
    try {
      const { members, pagination: meta } = await fetchMembers({
        page,
        limit: MEMBER_PAGE_SIZE,
        search: nextFilters.search || undefined,
        isActive: nextFilters.isActive === '' ? undefined : nextFilters.isActive,
        sortBy: 'createdAt',
        sortOrder: nextFilters.sortOrder || 'desc',
      });
      set({
        members,
        pagination: {
          page: meta?.page ?? page,
          limit: meta?.limit ?? MEMBER_PAGE_SIZE,
          total: meta?.total ?? 0,
          totalPages: meta?.totalPages ?? 1,
        },
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load team members.', code: error?.code },
      });
    }
  },

  ensureMembers: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    await get().refreshMembers();
  },

  setPage: (page) => get().refreshMembers({ page }),

  clearFilters: () => get().refreshMembers({ filters: { ...DEFAULT_FILTERS } }),

  fetchMemberDetail: async (id) => {
    if (!id) return null;
    set({ detailStatus: 'loading', detailError: null });
    try {
      const member = await fetchMemberById(id);
      set({ detail: member, detailStatus: 'success', detailError: null });
      return member;
    } catch (error) {
      set({
        detail: null,
        detailStatus: 'error',
        detailError: {
          message: error?.message ?? 'Failed to load the team member.',
          code: error?.code,
          status: error?.status,
        },
      });
      return null;
    }
  },

  /**
   * Reconcile a server-fresh member after a confirmed mutation (detail +
   * list mirror). The response is authoritative; nothing is merged or
   * recomputed client-side.
   */
  syncMember: (record) => {
    if (!record?.id) return;
    set((state) => {
      // Under an account-status filter a toggled row no longer matches
      // (the server would not return it) — it leaves the mirror.
      if (state.filters.isActive === 'true' && record.isActive === false) {
        return {
          detail: state.detail?.id === record.id ? record : state.detail,
          members: state.members.filter((item) => item.id !== record.id),
        };
      }
      if (state.filters.isActive === 'false' && record.isActive === true) {
        return {
          detail: state.detail?.id === record.id ? record : state.detail,
          members: state.members.filter((item) => item.id !== record.id),
        };
      }
      return {
        detail: state.detail?.id === record.id ? record : state.detail,
        members: state.members.some((item) => item.id === record.id)
          ? state.members.map((item) => (item.id === record.id ? { ...item, ...record } : item))
          : state.members,
      };
    });
  },

  setActive: async (id, isActive) => {
    const record = await setMemberActive(id, isActive);
    if (record?.id) get().syncMember(record);
    return record;
  },

  clearDetail: () => set({ detail: null, detailStatus: 'idle', detailError: null }),

  clearError: () => set({ error: null }),
}));
