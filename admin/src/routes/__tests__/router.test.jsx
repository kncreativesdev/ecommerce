import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import { router } from '../router.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';

vi.mock('../../services/return.service.js', () => ({
  fetchReturnsAdmin: vi.fn(),
  fetchReturnAdmin: vi.fn(),
}));

vi.mock('../../services/order.service.js', () => ({
  fetchOrdersAdmin: vi.fn(),
  fetchOrderAdmin: vi.fn(),
  updateOrderStatus: vi.fn(),
  bulkUpdateOrderStatus: vi.fn(),
  updateOrderPaymentStatus: vi.fn(),
}));

import { fetchReturnsAdmin, fetchReturnAdmin } from '../../services/return.service.js';

/**
 * Router-level regression coverage for admin route registration.
 *
 * Page tests below declare their own MemoryRouter routes, so a dropped or
 * mistyped entry in the real route table would surface as a NotFoundPage
 * 404 in production while the whole suite stays green. These tests render
 * the real `router` object so `/returns` and `/returns/:id` can never
 * silently detach from their pages again.
 */

function authenticateAdmin() {
  useAuthStore.setState({
    accessToken: 'token',
    user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] },
    status: 'ready',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateAdmin();
});

describe('admin router return orders registration', () => {
  it('/returns resolves to ReturnsPage, not the not-found page', async () => {
    fetchReturnsAdmin.mockResolvedValue({
      returns: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/returns');
    render(<RouterProvider router={router} />);

    // Header h1 + page h2 both carry the section title.
    const headings = await screen.findAllByRole('heading', { name: 'Return Orders' });
    expect(headings).toHaveLength(2);
    expect(await screen.findByText('No return requests')).toBeInTheDocument();
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
    expect(fetchReturnsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it('/returns/:id resolves to ReturnDetailPage with the route id', async () => {
    fetchReturnAdmin.mockResolvedValue({
      id: 'return-9',
      orderId: 'order-9',
      status: 'REQUESTED',
      reason: 'DAMAGED',
      details: null,
      createdAt: '2026-09-04T10:00:00.000Z',
      updatedAt: '2026-09-04T10:00:00.000Z',
      customer: { id: 'u9', email: 'buyer@example.test', firstName: 'Buy', lastName: 'Er', phone: '9999999999' },
      order: { id: 'order-9', orderNumber: 'ORD-2026-000009', status: 'DELIVERED', grandTotal: '100.00', createdAt: '2026-09-01T10:00:00.000Z' },
      history: [],
    });
    await router.navigate('/returns/return-9');
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Return — ORD-2026-000009' })).toBeInTheDocument();
    expect(fetchReturnAdmin).toHaveBeenCalledWith('return-9');
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
  });

  it('operations navigation reaches the registered return routes', async () => {
    const user = userEvent.setup();
    fetchReturnsAdmin.mockResolvedValue({
      returns: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/orders');
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'Orders', level: 1 })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    await user.click(within(nav).getByRole('link', { name: 'Return Orders' }));
    const headings = await screen.findAllByRole('heading', { name: 'Return Orders' });
    expect(headings).toHaveLength(2);
    expect(await screen.findByText('No return requests')).toBeInTheDocument();
  });

  it('unknown paths still render the not-found page', async () => {
    await router.navigate('/no-such-admin-page');
    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/page not found/i)).toBeInTheDocument();
  });
});
