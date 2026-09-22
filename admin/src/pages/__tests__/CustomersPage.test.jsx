import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { CustomersPage } from '../CustomersPage.jsx';
import { CustomerDetailPage } from '../CustomerDetailPage.jsx';
import { useCustomerStore } from '../../stores/useCustomerStore.js';
import { fetchCustomerById, fetchCustomers } from '../../services/customer.service.js';

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

function customerFixture(overrides = {}) {
  return {
    id: 'c1',
    email: 'ada@example.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '9999999999',
    isActive: true,
    roles: ['CUSTOMER'],
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
    ...overrides,
  };
}

function resetStore() {
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
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/customers']}>
      <Toaster />
      <Routes>
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('CustomersPage', () => {
  it('renders the customer list with the server total', async () => {
    fetchCustomers.mockResolvedValue({
      customers: [customerFixture(), customerFixture({ id: 'c2', email: 'grace@example.test', firstName: 'Grace', lastName: 'Hopper' })],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });
    renderList();

    expect(await screen.findByText('2 customers')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('grace@example.test')).toBeInTheDocument();
    expect(fetchCustomers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' }),
    );
  });

  it('searches by email/name through the server on Enter', async () => {
    const user = userEvent.setup();
    fetchCustomers.mockResolvedValue({ customers: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    renderList();
    await screen.findByText('0 customers');

    await user.type(screen.getByLabelText('Search customers by email or name'), 'ada@example');
    await user.keyboard('{Enter}');

    expect(fetchCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ada@example' }));
  });

  it('filters by account status through the server param', async () => {
    const user = userEvent.setup();
    fetchCustomers.mockResolvedValue({ customers: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const { container } = renderList();
    await screen.findByText('0 customers');

    const select = container.querySelector('#customer-status-filter');
    await user.selectOptions(select, 'false');

    expect(fetchCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ isActive: 'false' }));
  });

  it('paginates through server pages', async () => {
    const user = userEvent.setup();
    fetchCustomers
      .mockResolvedValueOnce({
        customers: [customerFixture()],
        pagination: { page: 1, limit: 1, total: 2, totalPages: 2 },
      })
      .mockResolvedValue({
        customers: [customerFixture({ id: 'c2', email: 'grace@example.test' })],
        pagination: { page: 2, limit: 1, total: 2, totalPages: 2 },
      });
    renderList();
    await screen.findByText('Ada Lovelace');

    await user.click(screen.getByRole('button', { name: 'Go to page 2' }));

    expect(fetchCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(await screen.findByText('grace@example.test')).toBeInTheDocument();
  });

  it('navigates to the customer detail page without a reload', async () => {
    fetchCustomers.mockResolvedValue({
      customers: [customerFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchCustomerById.mockResolvedValue(customerFixture());
    fetchOrdersAdmin.mockResolvedValue({ orders: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 1 } });
    fetchReviewsAdmin.mockResolvedValue({ reviews: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 1 } });
    const user = userEvent.setup();
    const hrefBefore = window.location.href;
    renderList();
    await screen.findByText('Ada Lovelace');

    await user.click(screen.getByRole('link', { name: 'View customer ada@example.test' }));

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(window.location.href).toBe(hrefBefore);
  });

  it('shows the error state with retry on server failure', async () => {
    fetchCustomers.mockRejectedValueOnce({ message: 'List failed.' });
    renderList();

    expect(await screen.findByText('Couldn’t load customers')).toBeInTheDocument();
    fetchCustomers.mockResolvedValue({ customers: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(fetchCustomers).toHaveBeenCalledTimes(2);
  });

  it('never renders sensitive auth fields', async () => {
    fetchCustomers.mockResolvedValue({
      customers: [{ ...customerFixture(), passwordHash: 'secret-should-never-render' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    const { container } = renderList();
    await screen.findByText('Ada Lovelace');
    expect(container.textContent).not.toContain('secret-should-never-render');
  });
});
