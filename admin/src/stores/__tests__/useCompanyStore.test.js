import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { COMPANY_PAGE_SIZE, useCompanyStore } from '../useCompanyStore.js';
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
} from '../../services/company.service.js';

vi.mock('../../services/company.service.js', () => ({
  createCompany: vi.fn(),
  createCompanyDomain: vi.fn(),
  deleteCompany: vi.fn(),
  deleteCompanyDomain: vi.fn(),
  fetchCompanies: vi.fn(),
  fetchCompanyDomains: vi.fn(),
  provisionCompanyAdmin: vi.fn(),
  resetCompanyAdminPassword: vi.fn(),
  restoreCompany: vi.fn(),
  suspendCompany: vi.fn(),
  updateCompanyDomain: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const basePagination = { page: 1, limit: COMPANY_PAGE_SIZE, total: 0, totalPages: 1 };

function companyFixture(overrides = {}) {
  return {
    id: 'c1',
    name: 'Acme Store',
    status: 'ACTIVE',
    adminProvisioned: false,
    domains: [],
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

function domainFixture(overrides = {}) {
  return {
    id: 'd1',
    domain: 'acme.test',
    isPrimary: true,
    isActive: true,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

function resetStore() {
  useCompanyStore.setState({
    companies: [],
    pagination: { ...basePagination },
    filters: { search: '', status: '' },
    status: 'idle',
    error: null,
    mutating: null,
    domainsCompany: null,
    companyDomains: [],
    domainsStatus: 'idle',
    domainsError: null,
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('useCompanyStore list', () => {
  it('loads the first page with server-driven pagination and stores rows + meta', async () => {
    const rows = [companyFixture()];
    fetchCompanies.mockResolvedValue({
      companies: rows,
      pagination: { page: 1, limit: COMPANY_PAGE_SIZE, total: 1, totalPages: 1 },
    });

    await useCompanyStore.getState().refreshCompanies();

    expect(fetchCompanies).toHaveBeenCalledWith({ page: 1, limit: COMPANY_PAGE_SIZE, search: undefined, status: undefined });
    const state = useCompanyStore.getState();
    expect(state.status).toBe('success');
    expect(state.companies).toEqual(rows);
    expect(state.pagination.total).toBe(1);
  });

  it('reports failure with the backend message and keeps no rows', async () => {
    fetchCompanies.mockRejectedValue({ message: 'Load failed.', code: 'HTTP_500' });

    await useCompanyStore.getState().refreshCompanies();

    const state = useCompanyStore.getState();
    expect(state.status).toBe('error');
    expect(state.companies).toEqual([]);
    expect(state.error.message).toBe('Load failed.');
  });

  it('ensureCompanies skips the fetch once loaded (no duplicate request)', async () => {
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { ...basePagination } });

    await useCompanyStore.getState().ensureCompanies();
    await useCompanyStore.getState().ensureCompanies();

    expect(fetchCompanies).toHaveBeenCalledTimes(1);
  });
});

describe('useCompanyStore create', () => {
  it('sends exactly the trimmed name, refreshes the list, and toasts', async () => {
    fetchCompanies.mockResolvedValue({ companies: [companyFixture()], pagination: { ...basePagination, total: 1 } });
    createCompany.mockResolvedValue(companyFixture());

    const { ok } = await useCompanyStore.getState().createNewCompany('Acme Store');

    expect(ok).toBe(true);
    expect(createCompany).toHaveBeenCalledWith({ name: 'Acme Store' });
    expect(createCompany).toHaveBeenCalledTimes(1);
    expect(fetchCompanies).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Company created.');
    expect(useCompanyStore.getState().mutating).toBeNull();
  });

  it('surfaces validation/backend errors as toasts without refreshing optimistically', async () => {
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { ...basePagination } });
    createCompany.mockRejectedValue({ message: 'Company name is required.', code: 'COMPANY_INVALID_NAME' });

    const { ok } = await useCompanyStore.getState().createNewCompany('Acme Store');

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Company name is required.');
    expect(useCompanyStore.getState().mutating).toBeNull();
  });

  it('blocks duplicate submissions while a mutation is pending', async () => {
    const gate = deferred();
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { ...basePagination } });
    createCompany.mockReturnValue(gate.promise);

    const first = useCompanyStore.getState().createNewCompany('Acme Store');
    const second = await useCompanyStore.getState().createNewCompany('Acme Store');

    expect(second).toEqual({ ok: false, duplicate: true });
    expect(createCompany).toHaveBeenCalledTimes(1);
    gate.resolve(companyFixture());
    await first;
  });
});

describe('useCompanyStore suspend/restore', () => {
  it('suspends by route id and refreshes instead of patching rows locally', async () => {
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ status: 'SUSPENDED' })],
      pagination: { ...basePagination, total: 1 },
    });
    suspendCompany.mockResolvedValue(companyFixture({ status: 'SUSPENDED' }));

    const { ok } = await useCompanyStore.getState().suspendOneCompany(companyFixture());

    expect(ok).toBe(true);
    expect(suspendCompany).toHaveBeenCalledWith('c1');
    expect(fetchCompanies).toHaveBeenCalled();
    expect(useCompanyStore.getState().companies[0].status).toBe('SUSPENDED');
  });

  it('surfaces transition conflicts (already-suspended) as user-facing errors', async () => {
    suspendCompany.mockRejectedValue({ message: 'Company is already suspended', code: 'COMPANY_ALREADY_SUSPENDED' });

    const { ok } = await useCompanyStore.getState().suspendOneCompany(companyFixture());

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Company is already suspended');
  });

  it('restores by route id and refreshes', async () => {
    fetchCompanies.mockResolvedValue({ companies: [companyFixture()], pagination: { ...basePagination, total: 1 } });
    restoreCompany.mockResolvedValue(companyFixture());

    const { ok } = await useCompanyStore.getState().restoreOneCompany(companyFixture({ status: 'SUSPENDED' }));

    expect(ok).toBe(true);
    expect(restoreCompany).toHaveBeenCalledWith('c1');
    expect(toast.success).toHaveBeenCalled();
  });

  it('surfaces already-active conflicts as user-facing errors', async () => {
    restoreCompany.mockRejectedValue({ message: 'Company is already active', code: 'COMPANY_ALREADY_ACTIVE' });

    const { ok } = await useCompanyStore.getState().restoreOneCompany(companyFixture({ status: 'SUSPENDED' }));

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Company is already active');
  });
});

describe('useCompanyStore admin provisioning + password reset', () => {
  it('provisions with the exact input and never stores the password in state', async () => {
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { ...basePagination } });
    provisionCompanyAdmin.mockResolvedValue({ id: 'u9', email: 'admin@acme.test' });

    const input = { email: 'admin@acme.test', password: 'secret-password', firstName: 'Ada', lastName: '', phone: '' };
    const { ok } = await useCompanyStore.getState().provisionAdmin(companyFixture(), input);

    expect(ok).toBe(true);
    expect(provisionCompanyAdmin).toHaveBeenCalledWith('c1', input);
    const snapshot = JSON.stringify(useCompanyStore.getState());
    expect(snapshot).not.toContain('secret-password');
  });

  it('handles existing-admin conflicts without leaking credentials', async () => {
    provisionCompanyAdmin.mockRejectedValue({ message: 'Company already has an ADMIN', code: 'COMPANY_ADMIN_EXISTS' });

    const { ok } = await useCompanyStore
      .getState()
      .provisionAdmin(companyFixture(), { email: 'a@b.test', password: 'secret-password', firstName: 'Ada' });

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Company already has an ADMIN');
    expect(JSON.stringify(useCompanyStore.getState())).not.toContain('secret-password');
  });

  it('resets the admin password with exactly { password } and clears it from state', async () => {
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { ...basePagination } });
    resetCompanyAdminPassword.mockResolvedValue({ id: 'u9' });

    const { ok } = await useCompanyStore.getState().resetAdminPassword(companyFixture(), { password: 'brand-new-secret' });

    expect(ok).toBe(true);
    expect(resetCompanyAdminPassword).toHaveBeenCalledWith('c1', { password: 'brand-new-secret' });
    expect(JSON.stringify(useCompanyStore.getState())).not.toContain('brand-new-secret');
  });
});

describe('useCompanyStore domain registry', () => {
  it('opens the registry for the route company and stores server domains', async () => {
    fetchCompanyDomains.mockResolvedValue([domainFixture()]);

    await useCompanyStore.getState().openCompanyDomains(companyFixture());

    expect(fetchCompanyDomains).toHaveBeenCalledWith('c1');
    const state = useCompanyStore.getState();
    expect(state.domainsCompany).toMatchObject({ id: 'c1', name: 'Acme Store' });
    expect(state.companyDomains).toEqual([domainFixture()]);
    expect(state.domainsStatus).toBe('success');
  });

  it('reports domain load failures with the backend message', async () => {
    fetchCompanyDomains.mockRejectedValue({ message: 'Load failed.', code: 'HTTP_500' });

    await useCompanyStore.getState().openCompanyDomains(companyFixture());

    const state = useCompanyStore.getState();
    expect(state.domainsStatus).toBe('error');
    expect(state.domainsError.message).toBe('Load failed.');
    expect(state.companyDomains).toEqual([]);
  });

  it('close clears the registry without any API call', async () => {
    fetchCompanyDomains.mockResolvedValue([domainFixture()]);
    await useCompanyStore.getState().openCompanyDomains(companyFixture());

    useCompanyStore.getState().closeCompanyDomains();

    const state = useCompanyStore.getState();
    expect(state.domainsCompany).toBeNull();
    expect(state.companyDomains).toEqual([]);
    expect(fetchCompanyDomains).toHaveBeenCalledTimes(1);
  });

  it('creates with the route company, then refreshes domains and the list', async () => {
    fetchCompanyDomains.mockResolvedValue([domainFixture()]);
    fetchCompanies.mockResolvedValue({ companies: [companyFixture()], pagination: { ...basePagination, total: 1 } });
    createCompanyDomain.mockResolvedValue(domainFixture({ domain: 'shop.example.com' }));

    const { ok } = await useCompanyStore.getState().createNewDomain(companyFixture(), 'shop.example.com');

    expect(ok).toBe(true);
    expect(createCompanyDomain).toHaveBeenCalledWith('c1', { domain: 'shop.example.com' });
    expect(createCompanyDomain).toHaveBeenCalledTimes(1);
    expect(fetchCompanyDomains).toHaveBeenCalledWith('c1');
    expect(fetchCompanies).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(useCompanyStore.getState().mutating).toBeNull();
  });

  it('toggles active state with the exact PATCH payload and surfaces conflicts', async () => {
    fetchCompanyDomains.mockResolvedValue([domainFixture()]);
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { ...basePagination } });
    updateCompanyDomain.mockResolvedValue(domainFixture({ isActive: false }));

    const { ok } = await useCompanyStore.getState().updateDomainState(companyFixture(), 'd1', { isActive: false });

    expect(ok).toBe(true);
    expect(updateCompanyDomain).toHaveBeenCalledWith('c1', 'd1', { isActive: false });
    expect(fetchCompanyDomains).toHaveBeenCalled();

    updateCompanyDomain.mockRejectedValue({ message: 'Domain is already registered', code: 'COMPANY_DOMAIN_EXISTS' });
    const failed = await useCompanyStore.getState().updateDomainState(companyFixture(), 'd1', { isActive: false });
    expect(failed.ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Domain is already registered');
  });

  it('promotes with { isPrimary: true } and deletes with route ids only', async () => {
    fetchCompanyDomains.mockResolvedValue([domainFixture()]);
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { ...basePagination } });
    updateCompanyDomain.mockResolvedValue(domainFixture());
    deleteCompanyDomain.mockResolvedValue({ id: 'd2', domain: 'old.test' });

    await useCompanyStore.getState().updateDomainState(companyFixture(), 'd2', { isPrimary: true });
    expect(updateCompanyDomain).toHaveBeenCalledWith('c1', 'd2', { isPrimary: true });

    const { ok } = await useCompanyStore.getState().deleteDomain(companyFixture(), { id: 'd2', domain: 'old.test' });
    expect(ok).toBe(true);
    expect(deleteCompanyDomain).toHaveBeenCalledWith('c1', 'd2');
    expect(deleteCompanyDomain).toHaveBeenCalledTimes(1);
  });

  it('blocks duplicate domain submissions while a mutation is pending', async () => {
    const gate = deferred();
    fetchCompanyDomains.mockResolvedValue([]);
    createCompanyDomain.mockReturnValue(gate.promise);

    const first = useCompanyStore.getState().createNewDomain(companyFixture(), 'shop.example.com');
    const second = await useCompanyStore.getState().createNewDomain(companyFixture(), 'shop.example.com');

    expect(second).toEqual({ ok: false, duplicate: true });
    expect(createCompanyDomain).toHaveBeenCalledTimes(1);
    gate.resolve(domainFixture());
    await first;
  });
});

describe('useCompanyStore permanent deletion', () => {
  it('deletes with exactly { confirmName } and refreshes the list', async () => {
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { ...basePagination } });
    deleteCompany.mockResolvedValue({ id: 'c1', name: 'Acme Store' });

    const { ok } = await useCompanyStore.getState().deleteOneCompany(companyFixture({ status: 'SUSPENDED' }), 'Acme Store');

    expect(ok).toBe(true);
    expect(deleteCompany).toHaveBeenCalledWith('c1', { confirmName: 'Acme Store' });
    expect(deleteCompany).toHaveBeenCalledTimes(1);
    expect(fetchCompanies).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('surfaces protected/not-suspended/not-found errors as toasts', async () => {
    deleteCompany.mockRejectedValue({ message: 'This company is protected and cannot be deleted', code: 'COMPANY_PROTECTED' });

    const { ok } = await useCompanyStore.getState().deleteOneCompany(companyFixture({ status: 'SUSPENDED' }), 'Tech Pulse');

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('This company is protected and cannot be deleted');
  });

  it('never cascades client-side: only the single delete call is issued', async () => {
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { ...basePagination } });
    deleteCompany.mockResolvedValue({ id: 'c1', name: 'Acme Store' });

    await useCompanyStore.getState().deleteOneCompany(companyFixture({ status: 'SUSPENDED' }), 'Acme Store');

    expect(deleteCompany).toHaveBeenCalledTimes(1);
    expect(suspendCompany).not.toHaveBeenCalled();
    expect(restoreCompany).not.toHaveBeenCalled();
  });
});
