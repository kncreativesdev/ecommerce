import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import { OrdersPage } from '../OrdersPage.jsx';
import { useOrderStore, ORDER_PAGE_SIZE } from '../../stores/useOrderStore.js';
import { fetchOrdersAdmin, bulkUpdateOrderStatus } from '../../services/order.service.js';

vi.mock('../../services/order.service.js', () => ({
  fetchOrdersAdmin: vi.fn(),
  fetchOrderAdmin: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateOrderPaymentStatus: vi.fn(),
  bulkUpdateOrderStatus: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function orderFixture(overrides = {}) {
  return {
    id: 'order-1',
    orderNumber: 'ORD-2026-000001',
    status: 'PENDING',
    grandTotal: '100.00',
    items: [{ id: 'li-1', quantity: 1 }],
    addresses: [],
    payments: [{ id: 'pay-1', method: 'CASH_ON_DELIVERY', status: 'PENDING', amount: '100.00' }],
    customer: { id: 'u1', email: 'a@example.test', firstName: 'A', lastName: 'B' },
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function resetStore() {
  useOrderStore.setState({
    orders: [],
    pagination: { page: 1, limit: ORDER_PAGE_SIZE, total: 0, totalPages: 1 },
    filters: { status: '', paymentStatus: '', search: '', city: '', state: '', from: '', to: '', sortOrder: 'desc' },
    status: 'idle',
    error: null,
    detail: null,
    detailStatus: 'idle',
    detailError: null,
  });
}

function renderOrders() {
  return render(
    <MemoryRouter initialEntries={['/orders']}>
      <Routes>
        <Route path="/orders" element={<OrdersPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('Admin city/state filtering', () => {
  it('sends city and state to the backend list', async () => {
    const user = userEvent.setup();
    fetchOrdersAdmin.mockResolvedValue({
      orders: [orderFixture()],
      pagination: { page: 1, limit: ORDER_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    renderOrders();
    await screen.findByText('ORD-2026-000001');

    const city = screen.getByLabelText('Filter by city');
    await user.type(city, 'Mumbai');
    fireEvent.blur(city);
    expect(fetchOrdersAdmin).toHaveBeenCalledWith(expect.objectContaining({ city: 'Mumbai' }));
    // Filters hide during the refetch — wait for the list to settle.
    await screen.findByText('ORD-2026-000001');

    const state = screen.getByLabelText('Filter by state');
    await user.type(state, 'Maharashtra');
    fireEvent.blur(state);
    expect(fetchOrdersAdmin).toHaveBeenCalledWith(expect.objectContaining({ state: 'Maharashtra' }));
  });
});

describe('Admin bulk selection + combined status update', () => {
  it('selects multiple orders, offers only common valid transitions, and reconciles after success', async () => {
    const user = userEvent.setup();
    fetchOrdersAdmin.mockResolvedValue({
      orders: [
        orderFixture({ id: 'o1', orderNumber: 'ORD-1', status: 'PENDING' }),
        orderFixture({ id: 'o2', orderNumber: 'ORD-2', status: 'PENDING' }),
      ],
      pagination: { page: 1, limit: ORDER_PAGE_SIZE, total: 2, totalPages: 1 },
    });
    bulkUpdateOrderStatus.mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]);
    renderOrders();
    await screen.findByText('ORD-1');

    await user.click(screen.getByLabelText('Select order ORD-1'));
    await user.click(screen.getByLabelText('Select order ORD-2'));
    expect(await screen.findByText('2 orders selected')).toBeInTheDocument();

    // Only common valid transitions (PENDING → CONFIRMED/CANCELLED) offered.
    const select = screen.getByLabelText('Bulk status target');
    const options = [...select.querySelectorAll('option')].map((o) => o.value);
    expect(options).toContain('CONFIRMED');
    expect(options).toContain('CANCELLED');
    expect(options).not.toContain('COMPLETED');
    expect(options).not.toContain('DELIVERED');

    await user.selectOptions(select, 'CONFIRMED');
    await user.click(screen.getByRole('button', { name: 'Apply to selected' }));
    expect(bulkUpdateOrderStatus).toHaveBeenCalledWith(['o1', 'o2'], 'CONFIRMED');
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/2 orders/i));
    // Server reconciliation: list refetched after the bulk.
    expect(fetchOrdersAdmin).toHaveBeenCalledTimes(2);
  });

  it('surfaces invalid-transition failures without false success', async () => {
    const user = userEvent.setup();
    fetchOrdersAdmin.mockResolvedValue({
      orders: [orderFixture({ id: 'o1', orderNumber: 'ORD-1', status: 'PENDING' })],
      pagination: { page: 1, limit: ORDER_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    const bulkError = new Error('One or more orders cannot make the requested transition');
    bulkError.details = [{ orderId: 'o1', code: 'ORDER_INVALID_STATUS_TRANSITION' }];
    bulkUpdateOrderStatus.mockRejectedValue(bulkError);
    renderOrders();
    await screen.findByText('ORD-1');

    await user.click(screen.getByLabelText('Select order ORD-1'));
    await user.selectOptions(screen.getByLabelText('Bulk status target'), 'CONFIRMED');
    await user.click(screen.getByRole('button', { name: 'Apply to selected' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
    expect(fetchOrdersAdmin).toHaveBeenCalledTimes(2);
  });
});
