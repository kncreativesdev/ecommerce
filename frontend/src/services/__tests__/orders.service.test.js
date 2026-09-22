import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPost } from '../../lib/apiClient.js';
import { createOrder } from '../orders.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('orders.service createOrder coupon passthrough', () => {
  it('sends address ids only when no coupon is applied (legacy behavior)', async () => {
    apiPost.mockResolvedValue({ order: { id: 'order-1' } });

    await createOrder({ shippingAddressId: 'ship-1', billingAddressId: undefined });

    expect(apiPost).toHaveBeenCalledWith('/orders', { shippingAddressId: 'ship-1' });
  });

  it('sends the coupon code alongside ids — never amounts or totals', async () => {
    apiPost.mockResolvedValue({ order: { id: 'order-1' } });

    await createOrder({ shippingAddressId: 'ship-1', billingAddressId: 'bill-1', couponCode: 'SAVE10' });

    expect(apiPost).toHaveBeenCalledWith('/orders', {
      shippingAddressId: 'ship-1',
      billingAddressId: 'bill-1',
      couponCode: 'SAVE10',
    });
  });
});
