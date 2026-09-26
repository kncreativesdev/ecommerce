import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet } from '../../lib/apiClient.js';
import { fetchActiveMarketing, resolveMarketingHref } from '../marketing.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('marketing.service (customer)', () => {
  it('fetches active broadcasts from the customer endpoint', async () => {
    const rows = [{ id: 'm1', title: 'Sale', linkType: 'SHOP', linkValue: null }];
    apiGet.mockResolvedValue({ notifications: rows });

    const result = await fetchActiveMarketing();

    expect(apiGet).toHaveBeenCalledWith('/marketing/notifications/active');
    expect(result).toEqual(rows);
  });

  it('falls back to an empty list on unexpected shapes', async () => {
    apiGet.mockResolvedValue(null);

    await expect(fetchActiveMarketing()).resolves.toEqual([]);
  });

  it('maps link types to internal routes, null link to no navigation', () => {
    expect(resolveMarketingHref({ linkType: 'SHOP', linkValue: null })).toBe('/shop');
    expect(resolveMarketingHref({ linkType: 'CATEGORY', linkValue: 'audio' })).toBe('/category/audio');
    expect(resolveMarketingHref({ linkType: 'PRODUCT', linkValue: 'abc-123' })).toBe('/product/abc-123');
    expect(resolveMarketingHref({ linkType: 'COUPON', linkValue: 'SAVE10' })).toBe('/shop');
    expect(resolveMarketingHref({ linkType: null, linkValue: null })).toBeNull();
    expect(resolveMarketingHref({ linkType: 'CATEGORY', linkValue: null })).toBeNull();
    expect(resolveMarketingHref({ linkType: 'UNKNOWN', linkValue: 'x' })).toBeNull();
    expect(resolveMarketingHref(null)).toBeNull();
  });
});
