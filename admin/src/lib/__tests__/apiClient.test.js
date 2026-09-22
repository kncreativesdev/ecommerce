import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, apiGetPage } from '../apiClient.js';

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiClient envelope handling', () => {
  it('apiGetPage preserves top-level meta while apiGet returns data only', async () => {
    const payload = { success: true, data: { coupons: [{ id: 'c1' }] }, meta: { total: 42, totalPages: 3 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));

    const page = await apiGetPage('/coupons?page=1&limit=20');
    expect(page).toEqual({ data: { coupons: [{ id: 'c1' }] }, meta: { total: 42, totalPages: 3 } });

    // The plain helper intentionally drops meta — paginated adapters must
    // use apiGetPage or totals silently default (the stale "0 coupons" bug).
    const dataOnly = await apiGet('/coupons?page=1&limit=20');
    expect(dataOnly).toEqual({ coupons: [{ id: 'c1' }] });
    expect(dataOnly.meta).toBeUndefined();
  });

  it('surfaces backend error envelopes as ApiError on both helpers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: { code: 'COUPON_NOT_FOUND', message: 'Missing' } }, { ok: false, status: 404 })),
    );

    await expect(apiGetPage('/coupons/nope')).rejects.toMatchObject({ status: 404, code: 'COUPON_NOT_FOUND' });
    await expect(apiGet('/coupons/nope')).rejects.toBeInstanceOf(ApiError);
  });
});
