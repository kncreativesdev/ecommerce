import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPost } from '../../lib/apiClient.js';
import { validateCoupon } from '../coupons.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('coupons.service (customer)', () => {
  it('validates through POST /coupons/validate with the code only', async () => {
    const quote = { coupon: { code: 'SAVE10' }, discountAmount: '20.00', eligibleSubtotal: '200.00', orderSubtotal: '200.00' };
    apiPost.mockResolvedValue(quote);

    const result = await validateCoupon(' save10 ');

    // The client sends the raw code (normalization is server-side); it
    // never sends cart lines, prices, or totals.
    expect(apiPost).toHaveBeenCalledWith('/coupons/validate', { code: ' save10 ' });
    expect(result).toEqual(quote);
  });

  it('propagates backend validation failures untouched', async () => {
    apiPost.mockRejectedValue({ code: 'COUPON_EXPIRED', message: 'Coupon has expired' });

    await expect(validateCoupon('OLD')).rejects.toMatchObject({ code: 'COUPON_EXPIRED' });
  });
});
