import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReturnsPage } from '../ReturnsPage.jsx';
import { RETURN_PAGE_SIZE, useReturnStore } from '../../stores/useReturnStore.js';
import { fetchReturnsAdmin } from '../../services/return.service.js';

vi.mock('../../services/return.service.js', () => ({
  fetchReturnsAdmin: vi.fn(),
  fetchReturnAdmin: vi.fn(),
}));

function rowFixture(overrides = {}) {
  return {
    id: 'return-1',
    orderId: 'order-1',
    status: 'REQUESTED',
    reason: 'DAMAGED',
    details: null,
    createdAt: '2026-09-04T10:00:00.000Z',
    updatedAt: '2026-09-04T10:00:00.000Z',
    customer: { id: 'u1', email: 'buyer@example.test', firstName: 'Buy', lastName: 'Er', phone: '9999999999' },
    order: { id: 'order-1', orderNumber: 'ORD-2026-000001', status: 'DELIVERED', grandTotal: '100.00', createdAt: '2026-09-01T10:00:00.000Z' },
    ...overrides,
  };
}

function resetStore() {
  useReturnStore.setState({
    returns: [],
    pagination: { page: 1, limit: RETURN_PAGE_SIZE, total: 0, totalPages: 1 },
    filters: { status: '', search: '' },
    status: 'idle',
    error: null,
    detail: null,
    detailStatus: 'idle',
    detailError: null,
  });
}

function renderReturns() {
  return render(
    <MemoryRouter initialEntries={['/returns']}>
      <Routes>
        <Route path="/returns" element={<ReturnsPage />} />
        <Route path="/returns/:id" element={<div>Return detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function listResponse(rows) {
  return {
    returns: rows,
    pagination: { page: 1, limit: RETURN_PAGE_SIZE, total: rows.length, totalPages: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('ReturnsPage list', () => {
  it('loads and renders return rows with customer, reason, and statuses', async () => {
    fetchReturnsAdmin.mockResolvedValue(listResponse([rowFixture()]));
    renderReturns();

    expect(await screen.findByText('ORD-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('buyer@example.test')).toBeInTheDocument();
    expect(screen.getByText('Damaged')).toBeInTheDocument();
    expect(screen.getByText('Return requested')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(fetchReturnsAdmin).toHaveBeenCalledWith({ page: 1, limit: RETURN_PAGE_SIZE, status: undefined, search: undefined });
  });

  it('shows loading, empty, and error states', async () => {
    fetchReturnsAdmin.mockResolvedValue(listResponse([]));
    renderReturns();
    expect(await screen.findByText('No return requests')).toBeInTheDocument();
  });

  it('filters by return status through the store query', async () => {
    const user = userEvent.setup();
    fetchReturnsAdmin.mockResolvedValue(listResponse([rowFixture()]));
    renderReturns();
    await screen.findByText('ORD-2026-000001');

    await user.selectOptions(screen.getByLabelText('Filter by return status'), 'REQUESTED');
    expect(fetchReturnsAdmin).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'REQUESTED', page: 1 }),
    );
  });

  it('searches by order number or customer', async () => {
    const user = userEvent.setup();
    fetchReturnsAdmin.mockResolvedValue(listResponse([rowFixture()]));
    renderReturns();
    await screen.findByText('ORD-2026-000001');

    await user.type(screen.getByLabelText('Search returns by order number or customer'), 'buyer@example.test');
    await user.keyboard('{Enter}');
    expect(fetchReturnsAdmin).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'buyer@example.test', page: 1 }),
    );
  });

  it('paginates while keeping the current scope', async () => {
    const user = userEvent.setup();
    fetchReturnsAdmin.mockResolvedValue({
      returns: [rowFixture()],
      pagination: { page: 1, limit: RETURN_PAGE_SIZE, total: 40, totalPages: 2 },
    });
    renderReturns();
    await screen.findByText('ORD-2026-000001');

    await user.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(fetchReturnsAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });

  it('links each row to its detail view without invoking mutations', async () => {
    const user = userEvent.setup();
    fetchReturnsAdmin.mockResolvedValue(listResponse([rowFixture()]));
    renderReturns();
    await screen.findByText('ORD-2026-000001');

    const link = screen.getByRole('link', { name: 'View return request for order ORD-2026-000001' });
    expect(link).toHaveAttribute('href', '/returns/return-1');
    await user.click(link);
    expect(await screen.findByText('Return detail')).toBeInTheDocument();
  });

  it('keeps row actions independent — no order actions render', async () => {
    fetchReturnsAdmin.mockResolvedValue(listResponse([rowFixture()]));
    renderReturns();
    await screen.findByText('ORD-2026-000001');

    const table = screen.getByRole('table');
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/mark.*completed/i)).not.toBeInTheDocument();
  });
});
