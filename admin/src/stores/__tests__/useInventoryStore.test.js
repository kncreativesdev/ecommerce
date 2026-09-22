import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INVENTORY_PAGE_SIZE, useInventoryStore } from '../useInventoryStore.js';
import { adjustInventory, fetchInventoryList, initializeInventory } from '../../services/inventory.service.js';

vi.mock('../../services/inventory.service.js', () => ({
  fetchVariantInventory: vi.fn(),
  fetchInventoryList: vi.fn(),
  fetchInventoryTransactions: vi.fn(),
  initializeInventory: vi.fn(),
  adjustInventory: vi.fn(),
}));

function itemFixture(overrides = {}) {
  return {
    product: { id: 'p1', name: 'Test Gadget', slug: 'test-gadget', isActive: true },
    variant: { id: 'v1', productId: 'p1', sku: 'GAD-BLK', name: 'Black', price: '1299.00', isActive: true, createdAt: '2026-09-01T10:00:00.000Z' },
    inventory: { id: 'i1', variantId: 'v1', quantity: 8, reservedQuantity: 0, availableQuantity: 8, updatedAt: '2026-09-19T10:00:00.000Z' },
    ...overrides,
  };
}

function resetStore() {
  useInventoryStore.setState({
    items: [],
    pagination: { page: 1, limit: INVENTORY_PAGE_SIZE, total: 0, totalPages: 1 },
    filters: { search: '', stock: '', active: '', sortBy: 'createdAt', sortOrder: 'desc' },
    status: 'idle',
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('useInventoryStore server-driven list', () => {
  it('refreshes page 1 with backend defaults and stores server meta', async () => {
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture()],
      pagination: { page: 1, limit: INVENTORY_PAGE_SIZE, total: 1, totalPages: 1 },
    });

    await useInventoryStore.getState().refreshInventory();

    expect(fetchInventoryList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: INVENTORY_PAGE_SIZE, sortBy: 'createdAt', sortOrder: 'desc' }),
    );
    expect(useInventoryStore.getState().items).toHaveLength(1);
    expect(useInventoryStore.getState().pagination.total).toBe(1);
    expect(useInventoryStore.getState().status).toBe('success');
  });

  it('resets to page 1 when filters change and keeps the page for plain paging', async () => {
    fetchInventoryList.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    await useInventoryStore.getState().refreshInventory();

    await useInventoryStore.getState().refreshInventory({ filters: { search: 'GAD' } });
    expect(fetchInventoryList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: 'GAD' }));
    expect(useInventoryStore.getState().filters.search).toBe('GAD');

    await useInventoryStore.getState().setPage(3);
    expect(fetchInventoryList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3, search: 'GAD' }));
  });

  it('clears filters back to defaults and refetches', async () => {
    fetchInventoryList.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    await useInventoryStore.getState().refreshInventory({ filters: { search: 'GAD', stock: 'out' } });
    expect(useInventoryStore.getState().filters.search).toBe('GAD');

    await useInventoryStore.getState().clearFilters();
    expect(useInventoryStore.getState().filters).toEqual({
      search: '', stock: '', active: '', sortBy: 'createdAt', sortOrder: 'desc',
    });
    expect(fetchInventoryList).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, stock: undefined }),
    );
  });

  it('stores the error (never fake rows) when the list fails', async () => {
    fetchInventoryList.mockRejectedValueOnce({ message: 'Stock backend down.' });
    await useInventoryStore.getState().refreshInventory();
    const state = useInventoryStore.getState();
    expect(state.status).toBe('error');
    expect(state.error.message).toBe('Stock backend down.');
    expect(state.items).toEqual([]);
  });

  it('ensureInventory skips refetch once loaded or loading', async () => {
    fetchInventoryList.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    useInventoryStore.setState({ status: 'success' });
    await useInventoryStore.getState().ensureInventory();
    expect(fetchInventoryList).not.toHaveBeenCalled();

    useInventoryStore.setState({ status: 'loading' });
    await useInventoryStore.getState().ensureInventory();
    expect(fetchInventoryList).not.toHaveBeenCalled();
  });
});

describe('useInventoryStore mutation reconciliation', () => {
  it('reconciles the authoritative record after adjust', async () => {
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    await useInventoryStore.getState().refreshInventory();

    adjustInventory.mockResolvedValue({ ...itemFixture().inventory, quantity: 13 });
    await useInventoryStore.getState().adjustStock('p1', 'v1', { quantity: 5 });
    expect(adjustInventory).toHaveBeenCalledWith('p1', 'v1', { quantity: 5 });
    expect(useInventoryStore.getState().items[0].inventory.quantity).toBe(13);
  });

  it('reconciles the authoritative record after initialize', async () => {
    useInventoryStore.setState({ items: [itemFixture({ inventory: null })], status: 'success' });
    initializeInventory.mockResolvedValue({ ...itemFixture().inventory, quantity: 25 });
    await useInventoryStore.getState().initializeStock('p1', 'v1', { quantity: 25 });
    expect(useInventoryStore.getState().items[0].inventory.quantity).toBe(25);
  });

  it('drops rows that no longer match the active stock filter (server truth)', async () => {
    useInventoryStore.setState({
      items: [itemFixture()],
      filters: { search: '', stock: 'out', active: '', sortBy: 'createdAt', sortOrder: 'desc' },
      status: 'success',
      error: null,
    });
    // Adding stock moves the variant out of the `out` filter — the mirror drops it.
    useInventoryStore.getState().syncItem('p1', 'v1', { ...itemFixture().inventory, quantity: 13, reservedQuantity: 0 });
    expect(useInventoryStore.getState().items).toHaveLength(0);
  });

  it('propagates mutation failures without touching the mirror', async () => {
    useInventoryStore.setState({ items: [itemFixture()], status: 'success' });
    adjustInventory.mockRejectedValueOnce({ code: 'INSUFFICIENT_STOCK', message: 'Nope' });
    await expect(useInventoryStore.getState().adjustStock('p1', 'v1', { quantity: -50 })).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
    expect(useInventoryStore.getState().items[0].inventory.quantity).toBe(8);
  });
});
