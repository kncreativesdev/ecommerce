import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGetPage } from '../../lib/apiClient.js';
import { fetchOrdersAdmin } from '../order.service.js';

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

describe('order.service list (meta regression)', () => {
  it('reads pagination from top-level meta via apiGetPage', async () => {
    // Same envelope flaw fixed for coupons: meta is TOP-LEVEL, so the
    // data-only helper would leave totals at 0 and hide pagination.
    apiGetPage.mockResolvedValue({
      data: { orders: [{ id: 'o1' }] },
      meta: { page: 1, limit: 20, total: 57, totalPages: 3 },
    });

    const result = await fetchOrdersAdmin({ page: 1, limit: 20 });

    expect(apiGetPage).toHaveBeenCalledWith(expect.stringContaining('/orders/admin?'));
    expect(result.orders).toEqual([{ id: 'o1' }]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 57, totalPages: 3 });
  });

  it('defaults missing meta instead of crashing the count', async () => {
    apiGetPage.mockResolvedValue({ data: { orders: [] }, meta: null });

    const result = await fetchOrdersAdmin({});

    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
  });
});
