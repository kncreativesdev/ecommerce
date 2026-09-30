import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import { OrderDetailPage } from '../OrderDetailPage.jsx';
import { cancelOrder, fetchOrderById, fetchReturnRequest } from '../../services/orders.service.js';
import { createReview, fetchMyReviews } from '../../services/reviews.service.js';

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
    status: 'PENDING',
    subtotal: '200.00',
    discountTotal: '0.00',
    shippingTotal: '0.00',
    taxTotal: '0.00',
    grandTotal: '200.00',
    currency: 'INR',
    items: [
      {
        id: 'item-1',
        productId: 'p1',
        variantId: 'v1',
        productName: 'Test Widget',
        variantName: 'Standard',
        sku: 'SKU-1',
        unitPrice: '100.00',
        discount: '0.00',
        quantity: 2,
        lineTotal: '200.00',
        imageStoragePath: null,
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    ],
    addresses: [
      {
        id: 'addr-1',
        type: 'SHIPPING',
        fullName: 'Test User',
        phone: '9999999999',
        addressLine1: '1 Test Street',
        addressLine2: null,
        city: 'Ludhiana',
        state: 'Punjab',
        postalCode: '141001',
        country: 'India',
      },
    ],
    payments: [
      {
        id: 'pay-1',
        method: 'CASH_ON_DELIVERY',
        status: 'PENDING',
        amount: '200.00',
        currency: 'INR',
        transactionReference: null,
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-09-01T10:00:00.000Z',
      },
    ],
    statusHistory: [
      { id: 'h1', status: 'PENDING', previousStatus: null, note: null, createdAt: '2026-09-01T10:00:00.000Z' },
    ],
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
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

beforeEach(() => {
  vi.clearAllMocks();
  fetchMyReviews.mockResolvedValue([]);
  createReview.mockResolvedValue({ id: 'r1' });
  // No return request by default; return-specific tests override per case.
  fetchReturnRequest.mockResolvedValue(null);
});

describe('OrderDetailPage cancellation', () => {
  it('shows Cancel Order for a cancellable (PENDING) order', async () => {
    fetchOrderById.mockResolvedValue(orderFixture({ status: 'PENDING' }));
    renderDetail();
    expect(await screen.findByRole('button', { name: 'Cancel Order' })).toBeInTheDocument();
  });

  it.each(['CONFIRMED', 'PROCESSING'])('shows Cancel Order for %s orders', async (status) => {
    fetchOrderById.mockResolvedValue(orderFixture({ status }));
    renderDetail();
    expect(await screen.findByRole('button', { name: 'Cancel Order' })).toBeInTheDocument();
  });

  it.each(['DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED'])(
    'does not show Cancel Order for %s orders',
    async (status) => {
      fetchOrderById.mockResolvedValue(orderFixture({ status }));
      renderDetail();
      await screen.findByRole('heading', { name: 'ORD-2026-000001' });
      expect(screen.queryByRole('button', { name: 'Cancel Order' })).not.toBeInTheDocument();
    },
  );

  it('opens a confirmation and closing it does not cancel', async () => {
    const user = userEvent.setup();
    fetchOrderById.mockResolvedValue(orderFixture());
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Cancel Order' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm order cancellation' });
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep order' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('confirming calls the cancel API with the order id', async () => {
    const user = userEvent.setup();
    fetchOrderById.mockResolvedValue(orderFixture());
    cancelOrder.mockResolvedValue(orderFixture({ status: 'CANCELLED' }));
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Cancel Order' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm Cancellation' }));

    expect(cancelOrder).toHaveBeenCalledTimes(1);
    expect(cancelOrder).toHaveBeenCalledWith('order-1');
  });

  it('prevents duplicate confirmations while the request is pending', async () => {
    const user = userEvent.setup();
    fetchOrderById.mockResolvedValue(orderFixture());
    const gate = deferred();
    cancelOrder.mockReturnValue(gate.promise);
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Cancel Order' }));

    const confirm = await screen.findByRole('button', { name: 'Confirm Cancellation' });
    await user.click(confirm);
    // Loading convention: disabled + busy + progress label.
    const cancelling = await screen.findByRole('button', { name: 'Cancelling…' });
    expect(cancelling).toBeDisabled();
    expect(cancelling).toHaveAttribute('aria-busy', 'true');
    // A second click while pending must not fire a second request.
    await user.click(cancelling);
    expect(cancelOrder).toHaveBeenCalledTimes(1);

    gate.resolve(orderFixture({ status: 'CANCELLED' }));
    await screen.findByText(/was cancelled/i);
  });

  it('refreshes to the cancelled state and hides the action on success', async () => {
    const user = userEvent.setup();
    fetchOrderById.mockResolvedValue(orderFixture({ status: 'PENDING' }));
    cancelOrder.mockResolvedValue(
      orderFixture({
        status: 'CANCELLED',
        statusHistory: [
          { id: 'h1', status: 'PENDING', previousStatus: null, note: null, createdAt: '2026-09-01T10:00:00.000Z' },
          { id: 'h2', status: 'CANCELLED', previousStatus: 'PENDING', note: null, createdAt: '2026-09-02T10:00:00.000Z' },
        ],
        // Backend truth: cancellation moves the payment to CANCELLED in
        // the same transaction — the refreshed order carries it.
        payments: [
          {
            id: 'pay-1',
            method: 'CASH_ON_DELIVERY',
            status: 'CANCELLED',
            amount: '200.00',
            currency: 'INR',
            transactionReference: null,
            createdAt: '2026-09-01T10:00:00.000Z',
            updatedAt: '2026-09-02T10:00:00.000Z',
          },
        ],
      }),
    );
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Cancel Order' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm Cancellation' }));

    // Cancelled timeline banner renders from the refreshed order.
    expect(await screen.findByText(/was cancelled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel Order' })).not.toBeInTheDocument();
    // The cancelled payment state renders from the same refreshed order.
    expect(screen.getByText(/CANCELLED/)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/cancelled/i));
  });

  it('surfaces backend rejection without falsely showing cancelled', async () => {
    const user = userEvent.setup();
    fetchOrderById.mockResolvedValue(orderFixture({ status: 'PENDING' }));
    cancelOrder.mockRejectedValue({ code: 'ORDER_INVALID_STATUS_TRANSITION', message: 'Cannot cancel order from PENDING.' });
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Cancel Order' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm Cancellation' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/cancel/i)));
    // Order state preserved: still PENDING, action still available.
    expect(screen.getByRole('button', { name: 'Cancel Order' })).toBeInTheDocument();
    expect(screen.queryByText(/was cancelled/i)).not.toBeInTheDocument();
  });
});

describe('OrderDetailPage review submission (no approval gate)', () => {
  async function openReviewForm(user) {
    fetchOrderById.mockResolvedValue(orderFixture({ status: 'DELIVERED' }));
    renderDetail();
    await user.click(await screen.findByRole('button', { name: /write a review/i }));
    return screen.findByRole('form', { name: 'Write a review' });
  }

  it('submits an eligible review and shows it live immediately', async () => {
    const user = userEvent.setup();
    const form = await openReviewForm(user);

    await user.click(within(form).getByRole('radio', { name: '5 stars' }));
    await user.click(within(form).getByRole('button', { name: 'Submit review' }));

    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({ orderItemId: 'item-1', rating: 5 }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/live/i)));
    // Visible without approval: form closes, item marked reviewed.
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Write a review' })).not.toBeInTheDocument());
    expect(screen.getByText(/reviewed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write a review/i })).not.toBeInTheDocument();
  });

  it('prevents duplicate submits while the request is pending', async () => {
    const user = userEvent.setup();
    const gate = deferred();
    createReview.mockReturnValue(gate.promise);
    const form = await openReviewForm(user);

    await user.click(within(form).getByRole('radio', { name: '4 stars' }));
    await user.click(within(form).getByRole('button', { name: 'Submit review' }));
    // Pending convention: submit disabled with progress label.
    const saving = await within(form).findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    await user.click(saving);
    expect(createReview).toHaveBeenCalledTimes(1);

    gate.resolve({ id: 'r1' });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('keeps validation errors working (rating required)', async () => {
    const user = userEvent.setup();
    const form = await openReviewForm(user);

    await user.click(within(form).getByRole('button', { name: 'Submit review' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent('Rating must be at least 1.');
    expect(createReview).not.toHaveBeenCalled();
  });

  it('treats an already-reviewed repeat as reviewed with guidance', async () => {
    const user = userEvent.setup();
    createReview.mockRejectedValue({ code: 'REVIEW_ALREADY_EXISTS', status: 409 });
    const form = await openReviewForm(user);

    await user.click(within(form).getByRole('radio', { name: '5 stars' }));
    await user.click(within(form).getByRole('button', { name: 'Submit review' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already reviewed/i)));
    expect(screen.getByText(/reviewed/i)).toBeInTheDocument();
  });
});

describe('OrderDetailPage product navigation', () => {
  it('links each ordered product to its product detail page', async () => {
    fetchOrderById.mockResolvedValue(orderFixture({ status: 'DELIVERED' }));
    renderDetail();
    await screen.findByRole('heading', { name: 'ORD-2026-000001' });

    // Product name, thumbnail, and an explicit View Product link all
    // route to the existing customer product detail page.
    const nameLink = screen.getByRole('link', { name: 'Test Widget' });
    expect(nameLink).toHaveAttribute('href', '/product/p1');
    expect(screen.getByRole('link', { name: 'View Test Widget' })).toHaveAttribute('href', '/product/p1');
    expect(screen.getByRole('link', { name: 'View Product' })).toHaveAttribute('href', '/product/p1');
  });
});

describe('OrderDetailPage coupon display', () => {
  function couponFixture() {
    return orderFixture({
      status: 'DELIVERED',
      discountTotal: '20.00',
      coupon: {
        id: 'c1',
        code: 'SAVE10',
        description: '10% off widgets',
        discountType: 'PERCENTAGE',
        discountValue: '10.00',
      },
    });
  }

  it('shows which coupon produced the order discount', async () => {
    fetchOrderById.mockResolvedValue(couponFixture());
    renderDetail();
    await screen.findByRole('heading', { name: 'ORD-2026-000001' });

    const block = screen.getByRole('group', { name: 'Coupon applied' });
    expect(within(block).getByText('SAVE10')).toBeInTheDocument();
    expect(within(block).getByText('· 10% off')).toBeInTheDocument();
    expect(within(block).getByText('10% off widgets')).toBeInTheDocument();
    expect(within(block).getByText(/You saved/)).toBeInTheDocument();
  });

  it('renders no coupon block for orders placed without a coupon', async () => {
    fetchOrderById.mockResolvedValue(orderFixture({ status: 'DELIVERED', coupon: null }));
    renderDetail();
    await screen.findByRole('heading', { name: 'ORD-2026-000001' });

    expect(screen.queryByRole('group', { name: 'Coupon applied' })).not.toBeInTheDocument();
  });
});
