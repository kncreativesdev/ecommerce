import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { InventoryPage } from '../InventoryPage.jsx';
import { useInventoryStore } from '../../stores/useInventoryStore.js';
import {
  adjustInventory,
  fetchInventoryList,
  fetchInventoryTransactions,
  initializeInventory,
} from '../../services/inventory.service.js';

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
    variant: {
      id: 'v1',
      productId: 'p1',
      sku: 'GAD-BLK',
      name: 'Black',
      price: '1299.00',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    inventory: {
      id: 'i1',
      variantId: 'v1',
      quantity: 8,
      reservedQuantity: 0,
      availableQuantity: 8,
      updatedAt: '2026-09-19T10:00:00.000Z',
    },
    ...overrides,
  };
}

function resetStore() {
  useInventoryStore.setState({
    items: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: { search: '', stock: '', active: '', sortBy: 'createdAt', sortOrder: 'desc' },
    status: 'idle',
    error: null,
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Toaster />
      <InventoryPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('InventoryPage', () => {
  it('renders the stock list with server meta and honest uninitialized rows', async () => {
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture(), itemFixture({
        variant: { id: 'v2', productId: 'p1', sku: 'GAD-WHT', name: 'White', price: '1299.00', isActive: true, createdAt: '2026-09-01T10:00:00.000Z' },
        inventory: null,
      })],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });
    renderPage();

    expect(await screen.findByText('2 variants')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Variant stock levels' });
    expect(within(table).getByText('GAD-BLK')).toBeInTheDocument();
    expect(within(table).getByText('8')).toBeInTheDocument();
    expect(within(table).getByText('In stock')).toBeInTheDocument();
    // A missing record is "Not initialized" — never a fake zero.
    expect(within(table).getByText('Not initialized')).toBeInTheDocument();
    expect(fetchInventoryList).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
  });

  it('searches through the server on Enter', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    renderPage();
    await screen.findByText('0 variants');

    await user.type(screen.getByLabelText('Search inventory by SKU, variant, or product'), 'GAD-BLK');
    await user.keyboard('{Enter}');
    expect(fetchInventoryList).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'GAD-BLK' }));
  });

  it('filters by stock and variant status through server params', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const { container } = renderPage();
    await screen.findByText('0 variants');

    await user.selectOptions(container.querySelector('#inventory-stock-filter'), 'out');
    expect(fetchInventoryList).toHaveBeenLastCalledWith(expect.objectContaining({ stock: 'out' }));

    await user.selectOptions(container.querySelector('#inventory-active-filter'), 'false');
    expect(fetchInventoryList).toHaveBeenLastCalledWith(expect.objectContaining({ active: 'false' }));
  });

  it('paginates through server pages', async () => {
    const user = userEvent.setup();
    fetchInventoryList
      .mockResolvedValueOnce({
        items: [itemFixture()],
        pagination: { page: 1, limit: 1, total: 2, totalPages: 2 },
      })
      .mockResolvedValue({
        items: [itemFixture({ variant: { ...itemFixture().variant, id: 'v2', sku: 'GAD-WHT' } })],
        pagination: { page: 2, limit: 1, total: 2, totalPages: 2 },
      });
    renderPage();
    await screen.findByText('GAD-BLK');

    await user.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(fetchInventoryList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(await screen.findByText('GAD-WHT')).toBeInTheDocument();
  });

  it('adjusts stock by delta with a note and reconciles the server record', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    adjustInventory.mockResolvedValue({ ...itemFixture().inventory, quantity: 13 });
    const hrefBefore = window.location.href;
    renderPage();
    await screen.findByText('GAD-BLK');

    await user.click(screen.getByRole('button', { name: 'Adjust stock for GAD-BLK' }));
    await user.type(screen.getByPlaceholderText('e.g. 10 or -3'), '5');
    await user.type(screen.getByPlaceholderText('e.g. Cycle count correction'), 'Cycle count');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));

    expect(adjustInventory).toHaveBeenCalledWith('p1', 'v1', { quantity: 5, note: 'Cycle count' });
    expect(await screen.findByText('13')).toBeInTheDocument();
    expect(await screen.findByText(/Added 5 to/)).toBeInTheDocument();
    expect(window.location.href).toBe(hrefBefore);
  });

  it('validates adjustments locally and surfaces server stock errors', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('GAD-BLK');

    await user.click(screen.getByRole('button', { name: 'Adjust stock for GAD-BLK' }));
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));
    expect(await screen.findByText('Enter a quantity.')).toBeInTheDocument();
    expect(adjustInventory).not.toHaveBeenCalled();

    adjustInventory.mockRejectedValueOnce({ code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock' });
    await user.type(screen.getByPlaceholderText('e.g. 10 or -3'), '-50');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));
    expect(await screen.findByText('Not enough stock for that removal.')).toBeInTheDocument();
  });

  it('initializes stock for uninitialized variants with an absolute quantity', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture({ inventory: null })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    initializeInventory.mockResolvedValue({ ...itemFixture().inventory, quantity: 25 });
    renderPage();
    await screen.findByText('GAD-BLK');

    await user.click(screen.getByRole('button', { name: 'Initialize stock for GAD-BLK' }));
    expect(screen.getByRole('dialog', { name: 'Initialize stock — GAD-BLK' })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('e.g. 25'), '25');
    await user.click(screen.getByRole('button', { name: 'Initialize stock' }));

    expect(initializeInventory).toHaveBeenCalledWith('p1', 'v1', { quantity: 25, note: undefined });
    expect(await screen.findByText('25')).toBeInTheDocument();
  });

  it('shows real ledger history newest-first with pagination', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchInventoryTransactions.mockResolvedValue({
      transactions: [
        { id: 't2', variantId: 'v1', quantity: 5, type: 'RESTOCK', referenceType: 'ADMIN', referenceId: null, note: 'Cycle count', createdAt: '2026-09-19T11:00:00.000Z' },
        { id: 't1', variantId: 'v1', quantity: 8, type: 'INITIAL_STOCK', referenceType: 'ADMIN', referenceId: null, note: null, createdAt: '2026-09-19T10:00:00.000Z' },
      ],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('GAD-BLK');

    await user.click(screen.getByRole('button', { name: 'View stock history for GAD-BLK' }));
    expect(fetchInventoryTransactions).toHaveBeenCalledWith('p1', 'v1', { page: 1, limit: 20 });
    expect(await screen.findByText('+5')).toBeInTheDocument();
    expect(screen.getByText('RESTOCK')).toBeInTheDocument();
    expect(screen.getByText(/Cycle count/)).toBeInTheDocument();
    expect(screen.getByText('INITIAL_STOCK')).toBeInTheDocument();
  });

  it('shows the error state with retry on server failure', async () => {
    fetchInventoryList.mockRejectedValueOnce({ message: 'Stock backend down.' });
    renderPage();

    expect(await screen.findByText('Couldn’t load inventory')).toBeInTheDocument();
    fetchInventoryList.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(fetchInventoryList).toHaveBeenCalledTimes(2);
  });
});

describe('InventoryPage empty, sort, and mutation integrity', () => {
  it('shows the genuine empty state when no variants exist', async () => {
    fetchInventoryList.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    renderPage();

    expect(await screen.findByText('No variants yet')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Variant stock levels' })).not.toBeInTheDocument();
  });

  it('shows the filtered-empty state (not the empty state) when filters match nothing', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    renderPage();
    await screen.findByText('No variants yet');

    await user.type(screen.getByLabelText('Search inventory by SKU, variant, or product'), 'NOPE-999');
    await user.keyboard('{Enter}');
    expect(fetchInventoryList).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'NOPE-999' }));
    expect(await screen.findByText('No variants match')).toBeInTheDocument();
    expect(screen.queryByText('No variants yet')).not.toBeInTheDocument();
  });

  it('maps sort controls to backend sortBy/sortOrder params', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const { container } = renderPage();
    await screen.findByText('0 variants');

    await user.selectOptions(container.querySelector('#inventory-sort'), 'sku-asc');
    expect(fetchInventoryList).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortBy: 'sku', sortOrder: 'asc' }),
    );
    await user.selectOptions(container.querySelector('#inventory-sort'), 'oldest');
    expect(fetchInventoryList).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortBy: 'createdAt', sortOrder: 'asc' }),
    );
  });

  it('clears all filters back to backend defaults', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    renderPage();
    await screen.findByText('0 variants');

    await user.type(screen.getByLabelText('Search inventory by SKU, variant, or product'), 'GAD');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(fetchInventoryList).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, stock: undefined, active: undefined }),
    );
  });

  it('rejects a zero delta locally without calling the service', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('GAD-BLK');

    await user.click(screen.getByRole('button', { name: 'Adjust stock for GAD-BLK' }));
    await user.type(screen.getByPlaceholderText('e.g. 10 or -3'), '0');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));
    expect(await screen.findByText('Adjustment must be a non-zero whole number.')).toBeInTheDocument();
    expect(adjustInventory).not.toHaveBeenCalled();
    // Failed validation never touches the rendered stock.
    expect(screen.getAllByText('8').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the old stock on failed adjustment (no fake local success)', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    adjustInventory.mockRejectedValueOnce({ code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock' });
    renderPage();
    await screen.findByText('GAD-BLK');

    await user.click(screen.getByRole('button', { name: 'Adjust stock for GAD-BLK' }));
    await user.type(screen.getByPlaceholderText('e.g. 10 or -3'), '-50');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));
    expect(await screen.findByText('Not enough stock for that removal.')).toBeInTheDocument();
    // Modal stays open on failure; the table still shows the old quantity.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('8').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('13')).not.toBeInTheDocument();
  });

  it('scopes the pending state: single service call, disabled controls, no close mid-flight', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    let resolveAdjust;
    adjustInventory.mockImplementationOnce(() => new Promise((resolve) => { resolveAdjust = resolve; }));
    renderPage();
    await screen.findByText('GAD-BLK');

    await user.click(screen.getByRole('button', { name: 'Adjust stock for GAD-BLK' }));
    await user.type(screen.getByPlaceholderText('e.g. 10 or -3'), '5');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));
    expect(adjustInventory).toHaveBeenCalledTimes(1);

    // Pending: apply is busy/disabled and a second submit is a no-op.
    const apply = screen.getByRole('button', { name: 'Apply adjustment' });
    expect(apply.disabled || apply.getAttribute('aria-busy') === 'true').toBe(true);
    await user.click(apply);
    expect(adjustInventory).toHaveBeenCalledTimes(1);

    resolveAdjust({ ...itemFixture().inventory, quantity: 13 });
    expect(await screen.findByText('13')).toBeInTheDocument();
  });

  it('writes no stock state to localStorage during adjustment', async () => {
    const user = userEvent.setup();
    const setSpy = vi.spyOn(Storage.prototype, 'setItem');
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    adjustInventory.mockResolvedValue({ ...itemFixture().inventory, quantity: 9 });
    renderPage();
    await screen.findByText('GAD-BLK');

    await user.click(screen.getByRole('button', { name: 'Adjust stock for GAD-BLK' }));
    await user.type(screen.getByPlaceholderText('e.g. 10 or -3'), '1');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));
    await screen.findByText('9');

    const stockWrites = setSpy.mock.calls.filter(([key]) => /stock|inventory|quantity/i.test(String(key)));
    expect(stockWrites).toHaveLength(0);
    setSpy.mockRestore();
  });

  it('shows history load failure with retry that recovers', async () => {
    const user = userEvent.setup();
    fetchInventoryList.mockResolvedValue({
      items: [itemFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchInventoryTransactions.mockRejectedValueOnce({ message: 'Ledger down.' });
    renderPage();
    await screen.findByText('GAD-BLK');

    await user.click(screen.getByRole('button', { name: 'View stock history for GAD-BLK' }));
    expect(await screen.findByText('Couldn’t load history')).toBeInTheDocument();

    fetchInventoryTransactions.mockResolvedValueOnce({
      transactions: [
        { id: 't1', variantId: 'v1', quantity: 8, type: 'INITIAL_STOCK', referenceType: 'ADMIN', referenceId: null, note: null, createdAt: '2026-09-19T10:00:00.000Z' },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('INITIAL_STOCK')).toBeInTheDocument();
    expect(fetchInventoryTransactions).toHaveBeenCalledTimes(2);
  });
});
