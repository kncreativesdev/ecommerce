import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost, apiPostForm } from '../../lib/apiClient.js';
import {
  PROTECTED_COMPANY_ID,
  createCompany,
  createCompanyDomain,
  deleteCompany,
  deleteCompanyDomain,
  deleteCompanyLogo,
  fetchCompanies,
  fetchCompanyById,
  fetchCompanyDomains,
  fetchPlatformSummary,
  isProtectedCompany,
  provisionCompanyAdmin,
  renameCompany,
  resetCompanyAdminPassword,
  resolveCompanyLogoUrl,
  restoreCompany,
  suspendCompany,
  updateCompany,
  updateCompanyDomain,
  uploadCompanyLogo,
} from '../company.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiGetPage: vi.fn(),
  apiPost: vi.fn(),
  apiPostForm: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

const company = {
  id: 'c1',
  name: 'Acme Store',
  status: 'ACTIVE',
  adminProvisioned: false,
  domains: [],
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('company.service list', () => {
  it('requests the paginated platform list and maps data + top-level meta', async () => {
    apiGetPage.mockResolvedValue({
      data: { companies: [company] },
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const result = await fetchCompanies();

    expect(apiGetPage).toHaveBeenCalledWith('/companies?page=1&limit=20');
    expect(result.companies).toEqual([company]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('forwards only the backend-supported search/status filters', async () => {
    apiGetPage.mockResolvedValue({ data: { companies: [] }, meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });

    await fetchCompanies({ page: 2, limit: 20, search: ' Acme ', status: 'SUSPENDED' });

    expect(apiGetPage).toHaveBeenCalledWith('/companies?page=2&limit=20&search=Acme&status=SUSPENDED');
  });

  it('falls back to an empty list when the envelope carries nothing', async () => {
    apiGetPage.mockResolvedValue({ data: null, meta: null });

    const result = await fetchCompanies();

    expect(result.companies).toEqual([]);
  });

  it('fetches detail by route id only (no companyId in params)', async () => {
    apiGet.mockResolvedValue({ company: { ...company, aggregates: { totalUsers: 3 } } });

    const result = await fetchCompanyById('c1');

    expect(apiGet).toHaveBeenCalledWith('/companies/c1');
    expect(result).toMatchObject({ id: 'c1', aggregates: { totalUsers: 3 } });
  });
});

describe('company.service create', () => {
  it('sends exactly { name } trimmed — no id/status/adminUserId/companyId', async () => {
    apiPost.mockResolvedValue({ company });

    const result = await createCompany({ name: '  Acme Store  ' });

    expect(apiPost).toHaveBeenCalledWith('/companies', { name: 'Acme Store' });
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(result).toEqual(company);
  });
});

describe('company.service suspend/restore', () => {
  it('suspends with an empty POST body to the route id', async () => {
    apiPost.mockResolvedValue({ company: { ...company, status: 'SUSPENDED' } });

    const result = await suspendCompany('c1');

    expect(apiPost).toHaveBeenCalledWith('/companies/c1/suspend');
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('SUSPENDED');
  });

  it('restores with an empty POST body to the route id', async () => {
    apiPost.mockResolvedValue({ company });

    const result = await restoreCompany('c1');

    expect(apiPost).toHaveBeenCalledWith('/companies/c1/restore');
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ACTIVE');
  });
});

describe('company.service admin provisioning', () => {
  it('sends the documented fields and returns the safe admin verbatim (no credential invented)', async () => {
    const admin = { id: 'u9', email: 'admin@acme.test', roles: ['ADMIN'] };
    apiPost.mockResolvedValue({ admin });

    const result = await provisionCompanyAdmin('c1', {
      email: 'admin@acme.test',
      password: 'secret-password',
      firstName: 'Ada',
      lastName: '',
      phone: '',
    });

    // Empty optional fields are dropped — the backend is strict and the
    // password itself travels request-only (never returned, never stored).
    expect(apiPost).toHaveBeenCalledWith('/companies/c1/admin', {
      email: 'admin@acme.test',
      password: 'secret-password',
      firstName: 'Ada',
    });
    expect(result).toEqual(admin);
    expect(JSON.stringify(result)).not.toContain('secret-password');
  });

  it('forwards non-empty optional fields trimmed', async () => {
    apiPost.mockResolvedValue({ admin: { id: 'u9' } });

    await provisionCompanyAdmin('c1', {
      email: 'admin@acme.test',
      password: 'secret-password',
      firstName: 'Ada',
      lastName: '  Lovelace ',
      phone: '  555  ',
    });

    expect(apiPost).toHaveBeenCalledWith('/companies/c1/admin', {
      email: 'admin@acme.test',
      password: 'secret-password',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '555',
    });
  });
});

describe('company.service admin password reset', () => {
  it('uses POST (not PATCH) with exactly { password } — no companyId/userId in the body', async () => {
    const { apiPatch } = await import('../../lib/apiClient.js');
    apiPost.mockResolvedValue({ admin: { id: 'u9', email: 'admin@acme.test' } });

    const result = await resetCompanyAdminPassword('c1', { password: 'brand-new-secret' });

    expect(apiPost).toHaveBeenCalledWith('/companies/c1/admin/password', { password: 'brand-new-secret' });
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPatch).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'u9', email: 'admin@acme.test' });
    expect(JSON.stringify(result ?? {})).not.toContain('brand-new-secret');
  });
});

describe('company.service permanent deletion', () => {
  it('sends exactly { confirmName } as a DELETE body — no force flags or UUID substitutes', async () => {
    apiDelete.mockResolvedValue({ deleted: { id: 'c1', name: 'Acme Store' } });

    const result = await deleteCompany('c1', { confirmName: 'Acme Store' });

    expect(apiDelete).toHaveBeenCalledWith('/companies/c1', { body: { confirmName: 'Acme Store' } });
    expect(apiDelete).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'c1', name: 'Acme Store' });
  });
});

describe('company.service domain registry', () => {
  const domain = {
    id: 'd1',
    domain: 'acme.test',
    isPrimary: true,
    isActive: true,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
  };

  it('lists domains by route id only (no companyId in params)', async () => {
    apiGet.mockResolvedValue({ domains: [domain] });

    const result = await fetchCompanyDomains('c1');

    expect(apiGet).toHaveBeenCalledWith('/companies/c1/domains');
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(result).toEqual([domain]);
  });

  it('falls back to an empty list when the envelope carries nothing', async () => {
    apiGet.mockResolvedValue(null);

    expect(await fetchCompanyDomains('c1')).toEqual([]);
  });

  it('registers with exactly { domain } trimmed — no companyId/isPrimary/isActive', async () => {
    apiPost.mockResolvedValue({ domain });

    const result = await createCompanyDomain('c1', { domain: '  Acme.TEST. ' });

    expect(apiPost).toHaveBeenCalledWith('/companies/c1/domains', { domain: 'Acme.TEST.' });
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(result).toEqual(domain);
  });

  it('updates active state with the exact PATCH body', async () => {
    apiPatch.mockResolvedValue({ domain: { ...domain, isActive: false } });

    const result = await updateCompanyDomain('c1', 'd1', { isActive: false });

    expect(apiPatch).toHaveBeenCalledWith('/companies/c1/domains/d1', { isActive: false });
    expect(apiPatch).toHaveBeenCalledTimes(1);
    expect(result.isActive).toBe(false);
  });

  it('promotes with the exact PATCH body', async () => {
    apiPatch.mockResolvedValue({ domain });

    const result = await updateCompanyDomain('c1', 'd1', { isPrimary: true });

    expect(apiPatch).toHaveBeenCalledWith('/companies/c1/domains/d1', { isPrimary: true });
    expect(result.isPrimary).toBe(true);
  });

  it('removes with a bodiless DELETE to the route ids', async () => {
    apiDelete.mockResolvedValue({ deleted: { id: 'd1', domain: 'acme.test' } });

    const result = await deleteCompanyDomain('c1', 'd1');

    expect(apiDelete).toHaveBeenCalledWith('/companies/c1/domains/d1');
    expect(apiDelete).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'd1', domain: 'acme.test' });
  });
});

describe('company.service Company #1 protection', () => {
  it('pins the foundation-migration UUID and detects the protected row', () => {
    expect(PROTECTED_COMPANY_ID).toBe('35b5a215-0cf3-42db-ba42-6fac6656a708');
    expect(isProtectedCompany({ id: PROTECTED_COMPANY_ID, name: 'Tech Pulse' })).toBe(true);
    expect(isProtectedCompany({ id: 'other-id', name: 'Tech Pulse' })).toBe(false);
    expect(isProtectedCompany(null)).toBe(false);
  });
});

describe('company.service profile update', () => {
  it('sends the approved metadata fields with no logoPath and no invented keys', async () => {
    apiPatch.mockResolvedValue({ company });

    const result = await updateCompany('c1', {
      name: 'Acme Renamed',
      contactEmail: 'hq@acme.test',
      contactPhone: '',
      addressLine1: '1 Market Street',
      addressLine2: '',
      city: 'Springfield',
      state: '',
      postalCode: '',
      country: '',
      website: '',
    });

    expect(apiPatch).toHaveBeenCalledWith('/companies/c1', {
      name: 'Acme Renamed',
      contactEmail: 'hq@acme.test',
      contactPhone: '',
      addressLine1: '1 Market Street',
      addressLine2: '',
      city: 'Springfield',
      state: '',
      postalCode: '',
      country: '',
      website: '',
    });
    expect(apiPatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual(company);
  });

  it('omits undefined profile fields and never forwards logoPath', async () => {
    apiPatch.mockResolvedValue({ company });

    await updateCompany('c1', { name: 'Acme', logoPath: 'companies/c1/branding/evil.webp', status: 'SUSPENDED' });

    expect(apiPatch).toHaveBeenCalledWith('/companies/c1', { name: 'Acme' });
  });

  it('renameCompany stays a name-only wrapper over the PATCH contract', async () => {
    apiPatch.mockResolvedValue({ company });

    await renameCompany('c1', { name: 'Acme Renamed' });

    expect(apiPatch).toHaveBeenCalledWith('/companies/c1', { name: 'Acme Renamed' });
  });

  it('fetches the platform summary from the aggregate-only endpoint', async () => {
    const summary = { totalCompanies: 2, totals: {} };
    apiGet.mockResolvedValue({ summary });

    const result = await fetchPlatformSummary();

    expect(apiGet).toHaveBeenCalledWith('/companies/summary');
    expect(result).toEqual(summary);
  });
});

describe('company.service logo upload/remove', () => {
  it('uploads multipart FormData with the file only', async () => {
    apiPostForm.mockResolvedValue({ company });
    const file = new File(['pixels'], 'logo.png', { type: 'image/png' });

    const result = await uploadCompanyLogo('c1', { file });

    expect(apiPostForm).toHaveBeenCalledTimes(1);
    expect(apiPostForm.mock.calls[0][0]).toBe('/companies/c1/logo');
    const formData = apiPostForm.mock.calls[0][1];
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get('image')).toBe(file);
    expect(result).toEqual(company);
  });

  it('removes with a bodiless DELETE to the logo route', async () => {
    apiDelete.mockResolvedValue({ company: { ...company, logoPath: null } });

    const result = await deleteCompanyLogo('c1');

    expect(apiDelete).toHaveBeenCalledWith('/companies/c1/logo');
    expect(result.logoPath).toBeNull();
  });

  it('resolves logo URLs from storage references and rejects anything else', () => {
    expect(resolveCompanyLogoUrl('companies/c1/branding/logo.webp', 'http://localhost:3000')).toBe(
      'http://localhost:3000/companies/c1/branding/logo.webp',
    );
    expect(resolveCompanyLogoUrl(null, 'http://localhost:3000')).toBeNull();
    expect(resolveCompanyLogoUrl('', 'http://localhost:3000')).toBeNull();
    expect(resolveCompanyLogoUrl('https://evil.test/logo.png', 'http://localhost:3000')).toBe(
      'http://localhost:3000/https://evil.test/logo.png',
    );
    expect(resolveCompanyLogoUrl('companies/c1/branding/logo.webp', '')).toBeNull();
  });
});
