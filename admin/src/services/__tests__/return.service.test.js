import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiGetPage } from '../../lib/apiClient.js';
import { fetchReturnAdmin, fetchReturnsAdmin } from '../return.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiGetPage: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

const row = {
  id: 'return-1',
  orderId: 'order-1',
  status: 'REQUESTED',
  reason: 'DAMAGED',
  details: null,
  createdAt: '2026-09-04T10:00:00.000Z',
  updatedAt: '2026-09-04T10:00:00.000Z',
  customer: { id: 'u1', email: 'buyer@example.test', firstName: 'Buy', lastName: 'Er', phone: '9999999999' },
  order: { id: 'order-1', orderNumber: 'ORD-2026-000001', status: 'DELIVERED', grandTotal: '100.00', createdAt: '2026-09-01T10:00:00.000Z' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('return.service list', () => {
  it('requests the documented default query and maps data + top-level meta', async () => {
    apiGetPage.mockResolvedValue({
      data: { returns: [row] },
      meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });

    const result = await fetchReturnsAdmin();

    expect(apiGetPage).toHaveBeenCalledWith('/returns?page=1&limit=20');
    expect(result.returns).toEqual([row]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
  });

  it('sends only supported filter params for status/search/page', async () => {
    apiGetPage.mockResolvedValue({ data: { returns: [] }, meta: { page: 2, limit: 20, total: 0, totalPages: 1 } });

    await fetchReturnsAdmin({ page: 2, limit: 20, status: 'REQUESTED', search: ' ORD-1 ' });

    expect(apiGetPage).toHaveBeenCalledWith('/returns?page=2&limit=20&status=REQUESTED&search=ORD-1');
  });

  it('omits empty filters and defaults missing meta', async () => {
    apiGetPage.mockResolvedValue({ data: {}, meta: null });

    const result = await fetchReturnsAdmin({ status: '', search: '   ' });

    expect(apiGetPage).toHaveBeenCalledWith('/returns?page=1&limit=20');
    expect(result.returns).toEqual([]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
  });

  it('fetches detail from the documented path', async () => {
    apiGet.mockResolvedValue({ returnRequest: row });

    await expect(fetchReturnAdmin('return-1')).resolves.toEqual(row);
    expect(apiGet).toHaveBeenCalledWith('/returns/return-1');
  });
});
