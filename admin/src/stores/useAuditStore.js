import { create } from 'zustand';
import { toast } from 'sonner';
import { downloadAuditLogsCsv, fetchAuditLogs } from '../services/audit.service.js';

export const AUDIT_PAGE_SIZE = 20;

const DEFAULT_FILTERS = {
  action: '',
  resource: '',
  outcome: '',
  role: '',
  actorId: '',
  resourceId: '',
  companyId: '',
  from: '',
  to: '',
};

/**
 * Admin audit-log state (Zustand) — backend-managed ONLY, strictly
 * read-only (the ReviewsPage pattern: server-driven filtering and
 * pagination, backend `meta` pagination, filter change resets to
 * page 1; no URL state, no client-side slicing, no mutation actions
 * of any kind — the backend exposes no audit write/delete endpoints).
 *
 * Export downloads the backend CSV verbatim for the CURRENT filters
 * (never page/limit, never client-built CSV) via a blob object URL.
 */
function toQuery(filters) {
  const query = {};
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === 'string' && value.trim() !== '') query[key] = value.trim();
  }
  return query;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const useAuditStore = create((set, get) => ({
  logs: [],
  pagination: { page: 1, limit: AUDIT_PAGE_SIZE, total: 0, totalPages: 1 },
  filters: { ...DEFAULT_FILTERS },
  status: 'idle',
  error: null,
  exporting: false,

  refreshLogs: async (overrides = {}) => {
    const { filters, pagination } = get();
    const nextFilters = { ...filters, ...(overrides.filters ?? {}) };
    const page = overrides.page ?? (overrides.filters ? 1 : pagination.page);
    set({ status: 'loading', error: null, filters: nextFilters });
    try {
      const { logs, pagination: meta } = await fetchAuditLogs({
        ...toQuery(nextFilters),
        page,
        limit: AUDIT_PAGE_SIZE,
      });
      set({
        logs,
        pagination: {
          page: meta?.page ?? page,
          limit: meta?.limit ?? AUDIT_PAGE_SIZE,
          total: meta?.total ?? 0,
          totalPages: meta?.totalPages ?? 1,
        },
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load audit logs.', code: error?.code },
      });
    }
  },

  ensureLogs: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    await get().refreshLogs();
  },

  setPage: (page) => get().refreshLogs({ page }),

  clearFilters: () => get().refreshLogs({ filters: { ...DEFAULT_FILTERS } }),

  clearError: () => set({ error: null }),

  exportLogs: async () => {
    const { filters, exporting } = get();
    if (exporting) return;
    set({ exporting: true });
    try {
      const { blob, filename } = await downloadAuditLogsCsv(toQuery(filters));
      saveBlob(blob, filename);
      toast.success('Audit logs exported.');
    } catch (error) {
      if (error?.code === 'AUDIT_EXPORT_TOO_LARGE') {
        toast.error('Export too large — narrow the filters and try again.');
      } else {
        toast.error(error?.message ?? 'Export failed. Please try again.');
      }
    } finally {
      set({ exporting: false });
    }
  },
}));
