import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from '../../lib/apiClient.js';
import {
  activateCoupon,
  createCoupon,
  deactivateCoupon,
  deleteCoupon,
  fetchCouponById,
  fetchCoupons,
  updateCoupon,
} from '../coupon.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiGetPage: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

const coupon = {
  id: 'coupon-1',
  code: 'SAVE10',
  discountType: 'PERCENTAGE',
  discountValue: '10.00',
  usageLimit: 100,
  usedCount: 14,
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('coupon.service list', () => {
  it('requests the documented default query and maps data + top-level meta', async () => {
    // The real envelope is `{ data: { coupons }, meta }` — meta is
    // TOP-LEVEL (apiClient returns data only, so the adapter must use
    // apiGetPage; a mock resolving meta inside data would mask that).
    apiGetPage.mockResolvedValue({
      data: { coupons: [coupon] },
      meta: { page: 1, limit: 20, total: 42, totalPages: 3 },
    });

    const result = await fetchCoupons();

    expect(apiGetPage).toHaveBeenCalledWith('/coupons?page=1&limit=20');
    expect(result.coupons).toEqual([coupon]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 42, totalPages: 3 });
  });

  it('sends only supported filter params for status/search/page', async () => {
    apiGetPage.mockResolvedValue({ data: { coupons: [] }, meta: { page: 2, limit: 20, total: 0, totalPages: 1 } });

    await fetchCoupons({ page: 2, limit: 20, status: 'active', search: ' SAVE ' });

    expect(apiGetPage).toHaveBeenCalledWith('/coupons?page=2&limit=20&status=active&search=SAVE');
  });

  it('omits the status param for the all scope and defaults missing meta', async () => {
    apiGetPage.mockResolvedValue({ data: { coupons: [] }, meta: null });

    const result = await fetchCoupons({ status: 'all' });

    expect(apiGetPage).toHaveBeenCalledWith('/coupons?page=1&limit=20');
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
  });

  it('fetches detail from the documented path', async () => {
    apiGet.mockResolvedValue({ coupon });

    await expect(fetchCouponById('coupon-1')).resolves.toEqual(coupon);
    expect(apiGet).toHaveBeenCalledWith('/coupons/coupon-1');
  });
});

describe('coupon.service mutations', () => {
  it('creates via POST /coupons with the exact body', async () => {
    const payload = { code: 'NEW10', discountType: 'PERCENTAGE', discountValue: '10' };
    apiPost.mockResolvedValue({ coupon });

    const result = await createCoupon(payload);

    expect(apiPost).toHaveBeenCalledWith('/coupons', payload);
    expect(result).toEqual(coupon);
  });

  it('updates via PATCH /coupons/:id', async () => {
    apiPatch.mockResolvedValue({ coupon });

    await updateCoupon('coupon-1', { description: 'Edited' });

    expect(apiPatch).toHaveBeenCalledWith('/coupons/coupon-1', { description: 'Edited' });
  });

  it('toggles availability with PATCH { isActive } bodies', async () => {
    apiPatch.mockResolvedValue({ coupon });

    await deactivateCoupon('coupon-1');
    expect(apiPatch).toHaveBeenCalledWith('/coupons/coupon-1', { isActive: false });

    await activateCoupon('coupon-1');
    expect(apiPatch).toHaveBeenCalledWith('/coupons/coupon-1', { isActive: true });
  });

  it('deletes via DELETE /coupons/:id', async () => {
    apiDelete.mockResolvedValue({ id: 'coupon-1' });

    await deleteCoupon('coupon-1');

    expect(apiDelete).toHaveBeenCalledWith('/coupons/coupon-1');
  });
});
