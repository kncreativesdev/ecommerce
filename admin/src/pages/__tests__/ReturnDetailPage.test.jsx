import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReturnDetailPage } from '../ReturnDetailPage.jsx';
import { useReturnStore } from '../../stores/useReturnStore.js';
import { fetchReturnAdmin } from '../../services/return.service.js';

vi.mock('../../services/return.service.js', () => ({
  fetchReturnsAdmin: vi.fn(),
  fetchReturnAdmin: vi.fn(),
}));

function detailFixture(overrides = {}) {
  return {
    id: 'return-1',
    orderId: 'order-1',
    status: 'REQUESTED',
    reason: 'OTHER',
    details: 'Does not match the photos.',
    createdAt: '2026-09-04T10:00:00.000Z',
    updatedAt: '2026-09-04T10:00:00.000Z',
    customer: { id: 'u1', email: 'buyer@example.test', firstName: 'Buy', lastName: 'Er', phone: '9999999999' },
    order: { id: 'order-1', orderNumber: 'ORD-2026-000001', status: 'DELIVERED', grandTotal: '100.00', createdAt: '2026-09-01T10:00:00.000Z' },
    history: [{ id: 'rh-1', status: 'REQUESTED', actorId: 'u1', createdAt: '2026-09-04T10:00:00.000Z' }],
    ...overrides,
  };
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/returns/return-1']}>
      <Routes>
        <Route path="/returns/:id" element={<ReturnDetailPage />} />
        <Route path="/returns" element={<div>Returns list</div>} />
        <Route path="/orders/:id" element={<div>Order detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useReturnStore.setState({ detail: null, detailStatus: 'idle', detailError: null });
});

describe('ReturnDetailPage', () => {
  it('shows return, customer, order context, and history distinctly', async () => {
    fetchReturnAdmin.mockResolvedValue(detailFixture());
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Return — ORD-2026-000001' })).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Return request' });
    expect(within(section).getByText('Other')).toBeInTheDocument();
    expect(within(section).getByText('Does not match the photos.')).toBeInTheDocument();
    expect(within(section).getByText('buyer@example.test')).toBeInTheDocument();
    expect(within(section).getByText('9999999999')).toBeInTheDocument();
    expect(within(section).getByText('Return requested')).toBeInTheDocument();

    const history = screen.getByRole('region', { name: 'Return history' });
    expect(within(history).getByText('Return requested')).toBeInTheDocument();
    expect(within(history).getByText(/Submitted by/)).toBeInTheDocument();

    const original = screen.getByRole('region', { name: 'Original order' });
    expect(within(original).getByText('ORD-2026-000001')).toBeInTheDocument();
    expect(within(original).getByText('Delivered')).toBeInTheDocument();
    expect(within(original).getByRole('link', { name: 'View full order' })).toHaveAttribute('href', '/orders/order-1');

    // Order lifecycle history is untouched: no order timeline renders here.
    expect(screen.queryByRole('region', { name: /order timeline/i })).not.toBeInTheDocument();
    expect(fetchReturnAdmin).toHaveBeenCalledWith('return-1');
  });

  it('offers no status-mutation actions', async () => {
    fetchReturnAdmin.mockResolvedValue(detailFixture());
    renderDetail();
    await screen.findByRole('heading', { name: 'Return — ORD-2026-000001' });

    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument();
  });

  it('shows a not-found state for unknown return requests', async () => {
    fetchReturnAdmin.mockRejectedValue({ status: 404, code: 'RETURN_NOT_FOUND', message: 'Return request not found' });
    renderDetail();

    expect(await screen.findByText('Return request not found')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Return request' })).not.toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    const user = userEvent.setup();
    fetchReturnAdmin.mockRejectedValueOnce(new Error('History unavailable'));
    fetchReturnAdmin.mockResolvedValueOnce(detailFixture());
    renderDetail();

    expect(await screen.findByText('Couldn’t load the return request')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByRole('heading', { name: 'Return — ORD-2026-000001' })).toBeInTheDocument();
    expect(fetchReturnAdmin).toHaveBeenCalledTimes(2);
  });
});
