import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import { OrderDetailPage } from '../OrderDetailPage.jsx';
import { fetchOrderById, fetchReturnRequest, requestReturn } from '../../services/orders.service.js';
import { fetchMyReviews } from '../../services/reviews.service.js';
import { RETURN_REASON_OPTIONS } from '../../lib/orderStatus.js';

vi.mock('../../services/orders.service.js', () => ({
  fetchOrderById: vi.fn(),
  cancelOrder: vi.fn(),
  createOrder: vi.fn(),
  fetchOrders: vi.fn(),
  fetchReturnRequest: vi.fn(),
  requestReturn: vi.fn(),
}));

vi.mock('../../services/reviews.service.js', () => ({
  fetchMyReviews: vi.fn(),
  fetchProductReviews: vi.fn(),
  createReview: vi.fn(),
  fetchReviewById: vi.fn(),
  updateReview: vi.fn(),
  deleteReview: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
    items: [],
    addresses: [],
    payments: [],
    statusHistory: [
      { id: 'h1', status: 'PENDING', previousStatus: null, note: null, createdAt: '2026-09-01T10:00:00.000Z' },
      { id: 'h2', status: 'DELIVERED', previousStatus: 'OUT_FOR_DELIVERY', note: null, createdAt: '2026-09-03T10:00:00.000Z' },
    ],
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-03T10:00:00.000Z',
    ...overrides,
  };
}

function returnFixture(overrides = {}) {
  return {
    id: 'return-1',
    orderId: 'order-1',
    status: 'REQUESTED',
    reason: 'DAMAGED',
    details: 'Box was crushed.',
    createdAt: '2026-09-04T10:00:00.000Z',
    updatedAt: '2026-09-04T10:00:00.000Z',
    ...overrides,
  };
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/account/orders/order-1']}>
      <Routes>
        <Route path="/account/orders/:id" element={<OrderDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openReturnForm(user, order = orderFixture()) {
  fetchOrderById.mockResolvedValue(order);
  fetchReturnRequest.mockResolvedValue(null);
  renderDetail();
  await user.click(await screen.findByRole('button', { name: 'Request Return' }));
  return screen.findByRole('dialog', { name: 'Request a return' });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMyReviews.mockResolvedValue([]);
});

describe('OrderDetailPage return action visibility', () => {
  it.each(['DELIVERED', 'COMPLETED'])('shows Request Return for %s orders without a request', async (status) => {
    fetchOrderById.mockResolvedValue(orderFixture({ status }));
    fetchReturnRequest.mockResolvedValue(null);
    renderDetail();
    expect(await screen.findByRole('button', { name: 'Request Return' })).toBeInTheDocument();
  });

  it.each(['PENDING', 'CONFIRMED', 'PROCESSING', 'DISPATCHED', 'IN_TRANSIT', 'CANCELLED'])(
    'does not show Request Return for %s orders',
    async (status) => {
      fetchOrderById.mockResolvedValue(orderFixture({ status }));
      fetchReturnRequest.mockResolvedValue(null);
      renderDetail();
      await screen.findByRole('heading', { name: 'ORD-2026-000001' });
      expect(screen.queryByRole('button', { name: 'Request Return' })).not.toBeInTheDocument();
    },
  );

  it('hides the action once a request exists and shows its status instead', async () => {
    fetchOrderById.mockResolvedValue(orderFixture());
    fetchReturnRequest.mockResolvedValue(returnFixture());
    renderDetail();

    await screen.findByRole('heading', { name: 'ORD-2026-000001' });
    expect(screen.queryByRole('button', { name: 'Request Return' })).not.toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Return request' });
    expect(within(section).getByText('Return requested')).toBeInTheDocument();
    expect(within(section).getByText('Damaged')).toBeInTheDocument();
    expect(within(section).getByText('Box was crushed.')).toBeInTheDocument();
    expect(requestReturn).not.toHaveBeenCalled();
  });
});

describe('OrderDetailPage return form', () => {
  it('opens the dialog with every reason option', async () => {
    const user = userEvent.setup();
    const dialog = await openReturnForm(user);

    const select = within(dialog).getByRole('combobox');
    const options = within(select).getAllByRole('option').map((option) => option.textContent);
    for (const { label } of RETURN_REASON_OPTIONS) {
      expect(options).toContain(label);
    }
    expect(RETURN_REASON_OPTIONS).toHaveLength(8);
  });

  it('requires a reason before submitting', async () => {
    const user = userEvent.setup();
    const dialog = await openReturnForm(user);

    await user.click(within(dialog).getByRole('button', { name: 'Submit return request' }));

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(requestReturn).not.toHaveBeenCalled();
  });

  it('requires details only when OTHER is selected', async () => {
    const user = userEvent.setup();
    const dialog = await openReturnForm(user);

    await user.selectOptions(within(dialog).getByRole('combobox'), 'OTHER');
    await user.click(within(dialog).getByRole('button', { name: 'Submit return request' }));
    expect(await within(dialog).findByText('Details are required when the reason is Other.')).toBeInTheDocument();
    expect(requestReturn).not.toHaveBeenCalled();

    await user.type(within(dialog).getByRole('textbox'), '   ');
    await user.click(within(dialog).getByRole('button', { name: 'Submit return request' }));
    expect(await within(dialog).findByText('Details are required when the reason is Other.')).toBeInTheDocument();
    expect(requestReturn).not.toHaveBeenCalled();
  });

  it('sends the trimmed payload on valid submission', async () => {
    const user = userEvent.setup();
    const dialog = await openReturnForm(user);
    requestReturn.mockResolvedValue(returnFixture());

    await user.selectOptions(within(dialog).getByRole('combobox'), 'OTHER');
    await user.type(within(dialog).getByRole('textbox'), '  Arrived scratched.  ');
    await user.click(within(dialog).getByRole('button', { name: 'Submit return request' }));

    expect(requestReturn).toHaveBeenCalledWith('order-1', { reason: 'OTHER', details: 'Arrived scratched.' });
  });

  it('prevents duplicate submits while the request is pending', async () => {
    const user = userEvent.setup();
    const dialog = await openReturnForm(user);
    const gate = deferred();
    requestReturn.mockReturnValue(gate.promise);

    await user.selectOptions(within(dialog).getByRole('combobox'), 'DAMAGED');
    await user.click(within(dialog).getByRole('button', { name: 'Submit return request' }));

    const submitting = await within(dialog).findByRole('button', { name: 'Submitting…' });
    expect(submitting).toBeDisabled();
    await user.click(submitting);
    expect(requestReturn).toHaveBeenCalledTimes(1);

    gate.resolve(returnFixture());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('OrderDetailPage return submission outcome', () => {
  it('closes the dialog, shows the request, and blocks resubmission on success', async () => {
    const user = userEvent.setup();
    const dialog = await openReturnForm(user);
    requestReturn.mockResolvedValue(returnFixture());

    await user.selectOptions(within(dialog).getByRole('combobox'), 'DAMAGED');
    await user.click(within(dialog).getByRole('button', { name: 'Submit return request' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/return requested/i));
    const section = await screen.findByRole('region', { name: 'Return request' });
    expect(within(section).getByText('Damaged')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request Return' })).not.toBeInTheDocument();
    // Timeline untouched: still the delivered history, no return states.
    const timeline = screen.getByRole('region', { name: 'Order timeline' });
    expect(within(timeline).getByText('Delivered')).toBeInTheDocument();
    expect(within(timeline).queryByText(/return requested/i)).not.toBeInTheDocument();
  });

  it('reconciles to the stored request on duplicate submission without false success', async () => {
    const user = userEvent.setup();
    const dialog = await openReturnForm(user);
    requestReturn.mockRejectedValue({ code: 'RETURN_ALREADY_REQUESTED', status: 409, message: 'A return request already exists for this order.' });
    fetchReturnRequest.mockResolvedValue(returnFixture());

    await user.selectOptions(within(dialog).getByRole('combobox'), 'DAMAGED');
    await user.click(within(dialog).getByRole('button', { name: 'Submit return request' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already exists/i)));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('region', { name: 'Return request' })).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps the form with values and shows the backend message on eligibility failure', async () => {
    const user = userEvent.setup();
    const dialog = await openReturnForm(user);
    requestReturn.mockRejectedValue({ code: 'ORDER_RETURN_NOT_ELIGIBLE', status: 422, message: 'Only delivered orders can be returned.' });

    await user.selectOptions(within(dialog).getByRole('combobox'), 'DAMAGED');
    await user.type(within(dialog).getByRole('textbox'), 'Screen flickers.');
    await user.click(within(dialog).getByRole('button', { name: 'Submit return request' }));

    expect(await within(dialog).findByText('Only delivered orders can be returned.')).toBeInTheDocument();
    // Values preserved, dialog still open, no success, no status section.
    expect(within(dialog).getByRole('textbox')).toHaveValue('Screen flickers.');
    expect(screen.queryByRole('region', { name: 'Return request' })).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
