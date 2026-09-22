import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OrdersPage } from '../OrdersPage.jsx';
import { useOrderStore, ORDER_PAGE_SIZE } from '../../stores/useOrderStore.js';
import { fetchOrdersAdmin } from '../../services/order.service.js';

vi.mock('../../services/order.service.js', () => ({
  fetchOrdersAdmin: vi.fn(),
  fetchOrderAdmin: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateOrderPaymentStatus: vi.fn(),
}));

function orderFixture(overrides = {}) {
  return {
    id: 'order-1',
    orderNumber: 'ORD-2026-000001',
    status: 'DELIVERED',
    subtotal: '200.00',
    discountTotal: '0.00',
    shippingTotal: '0.00',
    taxTotal: '0.00',
    grandTotal: '200.00',
    currency: 'INR',
    items: [{ id: 'li-1', quantity: 1 }],
    addresses: [],
    payments: [{ id: 'pay-1', method: 'CASH_ON_DELIVERY', status: 'PAID', amount: '200.00' }],
    customer: { id: 'u1', email: 'buyer@example.test', firstName: 'Buy', lastName: 'Er', phone: null },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  };
}

function resetStore() {
  useOrderStore.setState({
    orders: [],
    pagination: { page: 1, limit: ORDER_PAGE_SIZE, total: 0, totalPages: 1 },
    filters: { status: '', paymentStatus: '', search: '', from: '', to: '', sortOrder: 'desc' },
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

describe('OrdersPage completed filter', () => {
  it('Completed applies the backend DELIVERED terminal status (no invented enum)', async () => {
    const user = userEvent.setup();
    fetchOrdersAdmin.mockResolvedValue({
      orders: [orderFixture()],
      pagination: { page: 1, limit: ORDER_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    renderOrders();
    expect(await screen.findByText('ORD-2026-000001')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Completed' }));

    expect(fetchOrdersAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'DELIVERED' }),
    );
    const pressed = screen.getByRole('button', { name: 'Completed' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggling Completed off returns to the unfiltered list', async () => {
    const user = userEvent.setup();
    fetchOrdersAdmin.mockResolvedValue({
      orders: [orderFixture()],
      pagination: { page: 1, limit: ORDER_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    renderOrders();
    expect(await screen.findByText('ORD-2026-000001')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Completed' }));
    await user.click(screen.getByRole('button', { name: 'Completed' }));

    expect(fetchOrdersAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined }));
    expect(screen.getByRole('button', { name: 'Completed' })).toHaveAttribute('aria-pressed', 'false');
  });
});
