import { create } from 'zustand';
import { toast } from 'sonner';
import {
  createCompany,
  createCompanyDomain,
  deleteCompany,
  deleteCompanyDomain,
  fetchCompanies,
  fetchCompanyDomains,
  provisionCompanyAdmin,
  resetCompanyAdminPassword,
  restoreCompany,
  suspendCompany,
  updateCompanyDomain,
} from '../services/company.service.js';

export const COMPANY_PAGE_SIZE = 20;

const DEFAULT_FILTERS = {
  search: '',
  status: '',
};

/**
 * Super Admin company-management state (Zustand) — backend-managed
 * ONLY. Listing/filtering/pagination are SERVER-driven (the
 * backend exposes `page/limit/search/status`); every lifecycle or
 * credential mutation refetches the list afterwards instead of
 * assuming the old rows are still current (stale ACTIVE/SUSPENDED
 * state must never drive the next action). No URL state, no
 * client-side slicing, no operational data anywhere in this store.
 *
 * `mutating` names the in-flight operation (suspend/restore/delete/
 * provision/reset-password/create) so the UI disables exactly the
 * control that started it — duplicate submissions are impossible
 * while the request is pending.
 */
export const useCompanyStore = create((set, get) => ({
  companies: [],
  pagination: { page: 1, limit: COMPANY_PAGE_SIZE, total: 0, totalPages: 1 },
  filters: { ...DEFAULT_FILTERS },
  status: 'idle',
  error: null,
  mutating: null,
  // Domain registry for the company open in the domains modal
  // (Phase 2C-27). Server-driven like the list: every domain
  // mutation refetches both this registry and the company list
  // (rows render the primary domain), never patching locally.
  domainsCompany: null,
  companyDomains: [],
  domainsStatus: 'idle',
  domainsError: null,

  refreshCompanies: async (overrides = {}) => {
    const { filters, pagination } = get();
    const nextFilters = { ...filters, ...(overrides.filters ?? {}) };
    const page = overrides.page ?? (overrides.filters ? 1 : pagination.page);
    set({ status: 'loading', error: null, filters: nextFilters });
    try {
      const { companies, pagination: meta } = await fetchCompanies({
        page,
        limit: COMPANY_PAGE_SIZE,
        search: nextFilters.search || undefined,
        status: nextFilters.status || undefined,
      });
      set({
        companies,
        pagination: {
          page: meta?.page ?? page,
          limit: meta?.limit ?? COMPANY_PAGE_SIZE,
          total: meta?.total ?? 0,
          totalPages: meta?.totalPages ?? 1,
        },
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load companies.', code: error?.code },
      });
    }
  },

  ensureCompanies: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    await get().refreshCompanies();
  },

  setPage: (page) => get().refreshCompanies({ page }),

  clearFilters: () => get().refreshCompanies({ filters: { ...DEFAULT_FILTERS } }),

  clearError: () => set({ error: null }),

  runMutation: async (kind, fn, successMessage) => {
    const { mutating } = get();
    if (mutating) return { ok: false, duplicate: true };
    set({ mutating: kind });
    try {
      const result = await fn();
      // Re-read from the server: lifecycle state may have moved under
      // us (concurrent operators, races), so the list is refreshed
      // rather than patched locally.
      await get().refreshCompanies();
      if (successMessage) toast.success(successMessage);
      return { ok: true, result };
    } catch (error) {
      toast.error(error?.message ?? 'Operation failed. Please try again.');
      // Surface the failure to the caller as well (some surfaces render
      // it in-dialog instead of relying on the toast alone).
      return { ok: false, error };
    } finally {
      set({ mutating: null });
    }
  },

  createNewCompany: (name) =>
    get().runMutation('create', () => createCompany({ name }), 'Company created.'),
  suspendOneCompany: (company) =>
    get().runMutation('suspend', () => suspendCompany(company.id), `“${company.name}” suspended. Operations are paused; no data was deleted.`),
  restoreOneCompany: (company) =>
    get().runMutation('restore', () => restoreCompany(company.id), `“${company.name}” restored.`),
  provisionAdmin: (company, input) =>
    get().runMutation('provision', () => provisionCompanyAdmin(company.id, input), `Admin provisioned for “${company.name}”.`),
  resetAdminPassword: (company, input) =>
    get().runMutation('reset-password', () => resetCompanyAdminPassword(company.id, input), `Admin password updated for “${company.name}”.`),
  deleteOneCompany: (company, confirmName) =>
    get().runMutation('delete', () => deleteCompany(company.id, { confirmName }), `“${company.name}” permanently deleted.`),

  openCompanyDomains: (company) => {
    set({ domainsCompany: { id: company.id, name: company.name, status: company.status }, companyDomains: [], domainsStatus: 'idle', domainsError: null });
    return get().refreshCompanyDomains(company);
  },

  closeCompanyDomains: () => set({ domainsCompany: null, companyDomains: [], domainsStatus: 'idle', domainsError: null }),

  refreshCompanyDomains: async (company) => {
    set({ domainsStatus: 'loading', domainsError: null });
    try {
      const domains = await fetchCompanyDomains(company.id);
      // Stale-response guard: the operator may have closed the modal
      // or opened another company while the request was in flight.
      const current = get().domainsCompany;
      if (!current || current.id !== company.id) return;
      set({ companyDomains: domains, domainsStatus: 'success', domainsError: null });
    } catch (error) {
      const current = get().domainsCompany;
      if (!current || current.id !== company.id) return;
      set({
        domainsStatus: 'error',
        domainsError: { message: error?.message ?? 'Failed to load domains.', code: error?.code },
      });
    }
  },

  runDomainMutation: async (kind, company, fn, successMessage) => {
    const { mutating } = get();
    if (mutating) return { ok: false, duplicate: true };
    set({ mutating: kind });
    try {
      const result = await fn();
      // Re-read from the server: primary/active state may have moved
      // under us (concurrent operators), so both the registry and the
      // company list (which renders the primary domain) refresh
      // rather than patching locally.
      await get().refreshCompanyDomains(company);
      await get().refreshCompanies();
      if (successMessage) toast.success(successMessage);
      return { ok: true, result };
    } catch (error) {
      toast.error(error?.message ?? 'Operation failed. Please try again.');
      return { ok: false };
    } finally {
      set({ mutating: null });
    }
  },

  createNewDomain: (company, domain) =>
    get().runDomainMutation('domain-create', company, () => createCompanyDomain(company.id, { domain }), `Domain registered for “${company.name}”.`),
  updateDomainState: (company, domainId, patch) =>
    get().runDomainMutation('domain-update', company, () => updateCompanyDomain(company.id, domainId, patch), 'Domain updated.'),
  deleteDomain: (company, domainRow) =>
    get().runDomainMutation('domain-delete', company, () => deleteCompanyDomain(company.id, domainRow.id), `Domain “${domainRow.domain}” removed.`),
}));
