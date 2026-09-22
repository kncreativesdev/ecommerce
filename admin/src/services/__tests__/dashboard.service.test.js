import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet } from '../../lib/apiClient.js';
import { DASHBOARD_RANGES, fetchDashboardSummary } from '../dashboard.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiGetPage: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dashboard.service', () => {
  it('exposes exactly the backend-supported range enum', () => {
    expect(DASHBOARD_RANGES).toEqual(['today', 'week', 'month', 'year']);
  });

  it('defaults to the today range', async () => {
    apiGet.mockResolvedValue({ summary: { range: 'today' } });
    const result = await fetchDashboardSummary();
    expect(apiGet).toHaveBeenCalledWith('/dashboard/summary?range=today');
    expect(result).toEqual({ range: 'today' });
  });

  it.each(['today', 'week', 'month', 'year'])('sends the %s range as the only query param', async (range) => {
    apiGet.mockResolvedValue({ summary: { range } });
    await fetchDashboardSummary(range);
    expect(apiGet).toHaveBeenCalledWith(`/dashboard/summary?range=${range}`);
  });

  it('returns the authoritative summary object untouched (no frontend math)', async () => {
    const summary = {
      range: 'today',
      granularity: 'hour',
      orders: { total: 10, pending: 3, delivered: 3 },
      revenue: { total: '9000.00' },
      period: { orders: 4, revenue: '4321.09' },
      buckets: [{ bucketStart: '2026-09-19T10:00:00.000Z', orders: 1, revenue: '1000.00' }],
    };
    apiGet.mockResolvedValue({ summary });
    expect(await fetchDashboardSummary('today')).toBe(summary);
  });

  it('returns null (never a fake zero summary) when the envelope has no summary', async () => {
    apiGet.mockResolvedValue({});
    expect(await fetchDashboardSummary('week')).toBeNull();
    apiGet.mockResolvedValue(null);
    expect(await fetchDashboardSummary('week')).toBeNull();
  });

  it('propagates backend failures instead of resolving to zero', async () => {
    apiGet.mockRejectedValue(new Error('Analytics down.'));
    await expect(fetchDashboardSummary('today')).rejects.toThrow('Analytics down.');
  });
});
