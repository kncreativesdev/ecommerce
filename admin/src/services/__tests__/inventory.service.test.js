import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiGetPage, apiPatch, apiPost } from '../../lib/apiClient.js';
import {
  adjustInventory,
  fetchInventoryList,
  fetchInventoryTransactions,
  fetchVariantInventory,
  initializeInventory,
} from '../inventory.service.js';

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

describe('inventory.service list (server-driven params + meta envelope)', () => {
  it('requests backend defaults and reads items/meta from the page envelope', async () => {
    apiGetPage.mockResolvedValue({
      data: { items: [{ variant: { id: 'v1' } }] },
      meta: { page: 1, limit: 20, total: 57, totalPages: 3 },
    });

    const result = await fetchInventoryList();

    const url = apiGetPage.mock.calls[0][0];
    expect(url).toContain('/inventory?');
    expect(url).toContain('page=1');
    expect(url).toContain('limit=20');
    expect(url).toContain('sortBy=createdAt');
    expect(result.items).toEqual([{ variant: { id: 'v1' } }]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 57, totalPages: 3 });
  });

  it('trims search and allowlists stock/active values (never invents params)', async () => {
    apiGetPage.mockResolvedValue({ data: { items: [] }, meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });

    await fetchInventoryList({ search: '  GAD-BLK  ', stock: 'out', active: 'false', sortBy: 'sku', sortOrder: 'asc' });
    const url = apiGetPage.mock.calls[0][0];
    expect(url).toContain(`search=${encodeURIComponent('GAD-BLK')}`);
    expect(url).toContain('stock=out');
    expect(url).toContain('active=false');
    expect(url).toContain('sortBy=sku');
    expect(url).toContain('sortOrder=asc');
  });

  it('drops unsupported stock values and blank search instead of sending junk', async () => {
    apiGetPage.mockResolvedValue({ data: { items: [] }, meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });

    await fetchInventoryList({ search: '   ', stock: 'low', active: '' });
    const url = apiGetPage.mock.calls[0][0];
    expect(url).not.toContain('search=');
    expect(url).not.toContain('stock=');
    expect(url).not.toContain('active=');
  });

  it('defaults missing meta instead of crashing pagination', async () => {
    apiGetPage.mockResolvedValue({ data: { items: [] }, meta: null });
    const result = await fetchInventoryList({ page: 2 });
    expect(result.pagination).toEqual({ page: 2, limit: 20, total: 0, totalPages: 1 });
  });

  it('returns an empty list (never fake rows) when data is missing', async () => {
    apiGetPage.mockResolvedValue({ data: null, meta: null });
    const result = await fetchInventoryList();
    expect(result.items).toEqual([]);
  });
});

describe('inventory.service ledger + mutations', () => {
  it('fetches ledger history newest-first via the page envelope', async () => {
    apiGetPage.mockResolvedValue({
      data: { transactions: [{ id: 't1' }] },
      meta: { page: 2, limit: 20, total: 41, totalPages: 3 },
    });

    const result = await fetchInventoryTransactions('p1', 'v1', { page: 2, limit: 20 });

    expect(apiGetPage).toHaveBeenCalledWith(
      expect.stringContaining('/products/p1/variants/v1/inventory/transactions?page=2&limit=20'),
    );
    expect(result.transactions).toEqual([{ id: 't1' }]);
    expect(result.pagination.total).toBe(41);
  });

  it('initializes with an absolute quantity and a trimmed note', async () => {
    apiPost.mockResolvedValue({ inventory: { quantity: 25 } });
    const result = await initializeInventory('p1', 'v1', { quantity: 25, note: '  Cycle count  ' });
    expect(apiPost).toHaveBeenCalledWith('/products/p1/variants/v1/inventory', { quantity: 25, note: 'Cycle count' });
    expect(result).toEqual({ quantity: 25 });
  });

  it('omits blank notes so the backend receives a strict body', async () => {
    apiPost.mockResolvedValue({ inventory: { quantity: 25 } });
    await initializeInventory('p1', 'v1', { quantity: 25, note: '   ' });
    expect(apiPost).toHaveBeenCalledWith('/products/p1/variants/v1/inventory', { quantity: 25 });

    apiPatch.mockResolvedValue({ inventory: { quantity: 13 } });
    await adjustInventory('p1', 'v1', { quantity: 5, note: undefined });
    expect(apiPatch).toHaveBeenCalledWith('/products/p1/variants/v1/inventory', { quantity: 5 });
  });

  it('adjusts with the signed delta (never a recomputed total)', async () => {
    apiPatch.mockResolvedValue({ inventory: { quantity: 5 } });
    await adjustInventory('p1', 'v1', { quantity: -3, note: 'Damaged' });
    expect(apiPatch).toHaveBeenCalledWith('/products/p1/variants/v1/inventory', { quantity: -3, note: 'Damaged' });
  });

  it('reads a single variant record (null when uninitialized is handled by callers)', async () => {
    apiGet.mockResolvedValue({ inventory: { quantity: 8 } });
    expect(await fetchVariantInventory('p1', 'v1')).toEqual({ quantity: 8 });

    apiGet.mockResolvedValue({});
    expect(await fetchVariantInventory('p1', 'v1')).toBeNull();
  });

  it('propagates mutation failures instead of faking success', async () => {
    apiPatch.mockRejectedValue({ code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock' });
    await expect(adjustInventory('p1', 'v1', { quantity: -50 })).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
  });
});
