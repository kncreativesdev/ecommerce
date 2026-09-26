import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGetPage, apiPatch } from '../../lib/apiClient.js';
import { fetchOrdersAdmin, updateOrderStatus } from '../order.service.js';

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

describe('order.service status mutation (note support)', () => {
  it('sends status only when no note is given', async () => {
    apiPatch.mockResolvedValue({ order: { id: 'o1', status: 'CONFIRMED' } });

    const result = await updateOrderStatus('o1', 'CONFIRMED');

    expect(apiPatch).toHaveBeenCalledWith('/orders/admin/o1/status', { status: 'CONFIRMED' });
    expect(result).toEqual({ id: 'o1', status: 'CONFIRMED' });
  });

  it('attaches a non-empty note to the status payload', async () => {
    apiPatch.mockResolvedValue({ order: { id: 'o1', status: 'CONFIRMED' } });

    await updateOrderStatus('o1', 'CONFIRMED', 'Verified by phone.');

    expect(apiPatch).toHaveBeenCalledWith('/orders/admin/o1/status', {
      status: 'CONFIRMED',
      note: 'Verified by phone.',
    });
  });

  it('omits blank notes instead of sending empty strings', async () => {
    apiPatch.mockResolvedValue({ order: { id: 'o1', status: 'CONFIRMED' } });

    await updateOrderStatus('o1', 'CONFIRMED', '   ');

    expect(apiPatch).toHaveBeenCalledWith('/orders/admin/o1/status', { status: 'CONFIRMED' });
  });
});
