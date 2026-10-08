import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDownloadCsv, apiGetPage } from '../../lib/apiClient.js';
import { downloadAuditLogsCsv, fetchAuditLogs, fetchAuditSummary } from '../audit.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGetPage: vi.fn(),
  apiDownloadCsv: vi.fn(),
}));

const log = {
  id: 'log-1',
  actorId: 'u1',
  actorRole: 'ADMIN',
  actorEmail: 'admin@example.test',
  companyId: 'c1',
  action: 'CREATED',
  resource: 'USER',
  resourceId: 'u2',
  outcome: 'SUCCESS',
  details: null,
  createdAt: '2026-03-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('audit.service list', () => {
  it('requests the documented default query and maps data + top-level meta', async () => {
    apiGetPage.mockResolvedValue({
      data: { logs: [log] },
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const result = await fetchAuditLogs();

    expect(apiGetPage).toHaveBeenCalledWith('/audit-logs?page=1&limit=20');
    expect(result.logs).toEqual([log]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('sends only supported filter params and trims text filters', async () => {
    apiGetPage.mockResolvedValue({ data: { logs: [] }, meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });

    await fetchAuditLogs({
      page: 2,
      action: 'UPDATED',
      resource: 'ORDER',
      outcome: 'SUCCESS',
      role: 'ADMIN',
      actorId: 'u1',
      resourceId: 'o1',
      companyId: 'c1',
      from: '2026-01-01',
      to: '2026-02-01',
      search: 'anything',
      sortOrder: 'asc',
      companyName: 'Acme',
    });

    const [url] = apiGetPage.mock.calls[0];
    expect(url.startsWith('/audit-logs?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('page')).toBe('2');
    expect(params.get('action')).toBe('UPDATED');
    expect(params.get('resource')).toBe('ORDER');
    expect(params.get('outcome')).toBe('SUCCESS');
    expect(params.get('role')).toBe('ADMIN');
    expect(params.get('actorId')).toBe('u1');
    expect(params.get('resourceId')).toBe('o1');
    expect(params.get('companyId')).toBe('c1');
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-02-01');
    // Unsupported params (search/sort/companyName/...) are never sent.
    expect(params.get('search')).toBeNull();
    expect(params.get('sortOrder')).toBeNull();
    expect(params.get('companyName')).toBeNull();
  });
});

describe('audit.service export', () => {
  it('requests the backend CSV with filters and never page/limit', async () => {
    apiDownloadCsv.mockResolvedValue({ blob: new Blob(['a']), filename: 'audit-logs.csv' });

    await downloadAuditLogsCsv({ resource: 'ORDER', action: 'UPDATED', page: 3, limit: 5 });

    const [url] = apiDownloadCsv.mock.calls[0];
    expect(url.startsWith('/audit-logs/export')).toBe(true);
    const query = url.includes('?') ? url.split('?')[1] : '';
    const params = new URLSearchParams(query);
    expect(params.get('resource')).toBe('ORDER');
    expect(params.get('action')).toBe('UPDATED');
    expect(params.get('page')).toBeNull();
    expect(params.get('limit')).toBeNull();
  });

  it('returns the backend blob and filename untouched', async () => {
    const blob = new Blob(['id\n1']);
    apiDownloadCsv.mockResolvedValue({ blob, filename: 'audit-logs-20260304T050607Z.csv' });

    const result = await downloadAuditLogsCsv({ outcome: 'FAILURE' });

    expect(result.blob).toBe(blob);
    expect(result.filename).toBe('audit-logs-20260304T050607Z.csv');
  });
});

describe('audit.service summary', () => {
  const summary = {
    total: 3,
    period: { from: '2026-02-01T00:00:00.000Z', to: '2026-03-03T00:00:00.000Z' },
    byOutcome: [{ outcome: 'SUCCESS', count: 3 }],
    byAction: [{ action: 'CREATED', count: 3 }],
    byResource: [{ resource: 'USER', count: 3 }],
    topActors: [{ actorId: 'u1', actorRole: 'ADMIN', count: 3 }],
    byDay: [{ date: '2026-03-02', count: 3 }],
    recent: log,
  };

  it('requests the summary endpoint and returns the summary verbatim', async () => {
    apiGetPage.mockResolvedValue({ data: { summary }, meta: null });

    expect(await fetchAuditSummary()).toEqual(summary);
    expect(apiGetPage).toHaveBeenCalledWith('/audit-logs/summary');
  });

  it('sends only supported filter params (never pagination or invented keys)', async () => {
    apiGetPage.mockResolvedValue({ data: { summary }, meta: null });

    await fetchAuditSummary({
      action: 'UPDATED',
      resource: 'ORDER',
      outcome: 'FAILURE',
      companyId: 'c1',
      from: '2026-01-01',
      to: '2026-02-01',
      page: 3,
      limit: 5,
      search: 'anything',
    });

    const [url] = apiGetPage.mock.calls[0];
    expect(url.startsWith('/audit-logs/summary?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('action')).toBe('UPDATED');
    expect(params.get('resource')).toBe('ORDER');
    expect(params.get('outcome')).toBe('FAILURE');
    expect(params.get('companyId')).toBe('c1');
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-02-01');
    expect(params.get('page')).toBeNull();
    expect(params.get('limit')).toBeNull();
    expect(params.get('search')).toBeNull();
  });
});
