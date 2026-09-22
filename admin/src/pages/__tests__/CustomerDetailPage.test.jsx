import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { CustomerDetailPage } from '../CustomerDetailPage.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useCustomerStore } from '../../stores/useCustomerStore.js';
import { fetchCustomerById, setCustomerActive } from '../../services/customer.service.js';

vi.mock('../../services/customer.service.js', () => ({
  fetchCustomers: vi.fn(),
  fetchCustomerById: vi.fn(),
  setCustomerActive: vi.fn(),
}));

vi.mock('../../services/order.service.js', () => ({
  fetchOrdersAdmin: vi.fn(),
  fetchOrderAdmin: vi.fn(),
  updateOrderStatus: vi.fn(),
  updatePaymentStatus: vi.fn(),
}));

vi.mock('../../services/review.service.js', () => ({
  fetchReviewsAdmin: vi.fn(),
  setReviewApproved: vi.fn(),
  deleteReviewAdmin: vi.fn(),
}));

import { fetchOrdersAdmin } from '../../services/order.service.js';
import { fetchReviewsAdmin } from '../../services/review.service.js';

const CUSTOMER = {
  id: 'c1',
  email: 'ada@example.test',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '9999999999',
  isActive: true,
  roles: ['CUSTOMER'],
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:00:00.000Z',
};

function resetStores() {
  useCustomerStore.setState({
    customers: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: { search: '', isActive: '', sortOrder: 'desc' },
    status: 'idle',
    error: null,
    detail: null,
    detailStatus: 'idle',
    detailError: null,
  });
  useAuthStore.setState({ user: { id: 'admin1', email: 'admin@example.test', roles: ['ADMIN'] } });
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/customers/c1']}>
      <Toaster />
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/orders/:id" element={<div>Order detail stub</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStores();
  fetchCustomerById.mockResolvedValue(CUSTOMER);
  fetchOrdersAdmin.mockResolvedValue({ orders: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 1 } });
  fetchReviewsAdmin.mockResolvedValue({ reviews: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 1 } });
});

describe('CustomerDetailPage', () => {
  it('renders the safe profile and linked order/review summaries', async () => {
    fetchOrdersAdmin.mockResolvedValue({
      orders: [{ id: 'o1', orderNumber: 'ORD-2026-000007', createdAt: '2026-03-01T10:00:00.000Z' }],
      pagination: { page: 1, limit: 5, total: 3, totalPages: 1 },
    });
    fetchReviewsAdmin.mockResolvedValue({
      reviews: [{ id: 'r1', rating: 5, title: 'Great', isApproved: false, product: { name: 'Gadget' } }],
      pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
    });
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('ada@example.test')).toBeInTheDocument();
    expect(screen.getByText('9999999999')).toBeInTheDocument();
    expect(screen.getByText('CUSTOMER')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    // Linked summaries come from the real admin APIs (email-scoped search,
    // exact user id) and navigate to existing routes.
    expect(fetchOrdersAdmin).toHaveBeenCalledWith(expect.objectContaining({ search: 'ada@example.test' }));
    expect(fetchReviewsAdmin).toHaveBeenCalledWith(expect.objectContaining({ userId: 'c1' }));
    expect(screen.getByText('ORD-2026-000007')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ORD-2026-000007/ })).toHaveAttribute('href', '/orders/o1');
    expect(screen.getByText(/5\/5/)).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('deactivates behind a confirmation and reconciles server state', async () => {
    const user = userEvent.setup();
    setCustomerActive.mockResolvedValue({ ...CUSTOMER, isActive: false });
    renderDetail();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(screen.getByRole('dialog', { name: 'Deactivate this account?' })).toBeInTheDocument();
    expect(setCustomerActive).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Yes, deactivate' }));
    expect(setCustomerActive).toHaveBeenCalledWith('c1', false);
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    expect(await screen.findByText(/deactivated/)).toBeInTheDocument();
  });

  it('reactivates an inactive account', async () => {
    const user = userEvent.setup();
    fetchCustomerById.mockResolvedValue({ ...CUSTOMER, isActive: false });
    setCustomerActive.mockResolvedValue(CUSTOMER);
    renderDetail();
    await screen.findByText('Inactive');

    await user.click(screen.getByRole('button', { name: 'Reactivate' }));
    expect(setCustomerActive).toHaveBeenCalledWith('c1', true);
    expect(await screen.findByText('“Ada Lovelace” reactivated.')).toBeInTheDocument();
  });

  it('disables deactivation for the signed-in admin own account', async () => {
    useAuthStore.setState({ user: { id: 'c1', email: 'ada@example.test', roles: ['ADMIN'] } });
    renderDetail();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });

    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDisabled();
  });

  it('renders the not-found state for unknown customers', async () => {
    fetchCustomerById.mockRejectedValue({ status: 404, code: 'USER_NOT_FOUND', message: 'User not found' });
    renderDetail();

    expect(await screen.findByText('Customer not found')).toBeInTheDocument();
  });
});
