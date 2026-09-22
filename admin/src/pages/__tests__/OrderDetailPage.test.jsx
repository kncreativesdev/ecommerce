import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OrderDetailPage } from '../OrderDetailPage.jsx';
import { useOrderStore, ORDER_PAGE_SIZE } from '../../stores/useOrderStore.js';
import { fetchOrderAdmin } from '../../services/order.service.js';

vi.mock('../../services/order.service.js', () => ({
  fetchOrdersAdmin: vi.fn(),
  fetchOrderAdmin: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateOrderPaymentStatus: vi.fn(),
}));

function detailFixture() {
  return {
    id: 'order-9',
    orderNumber: 'ORD-2026-000009',
    status: 'DELIVERED',
    subtotal: '320.00',
    discountTotal: '0.00',
    shippingTotal: '0.00',
    taxTotal: '0.00',
    grandTotal: '320.00',
    currency: 'INR',
    items: [
      {
        id: 'li-a',
        productId: 'p1',
        variantId: 'v-a',
        productName: 'Test Shirt',
        variantName: 'Black',
        sku: 'SHIRT-BLK',
        unitPrice: '100.00',
        discount: '0.00',
        quantity: 2,
        lineTotal: '200.00',
        imageStoragePath: 'products/p1/black-primary.webp',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'li-legacy',
        productId: 'p2',
        variantId: 'v-old',
        productName: 'Legacy Widget',
        variantName: 'Old',
        sku: 'WID-OLD',
        unitPrice: '120.00',
        discount: '0.00',
        quantity: 1,
        lineTotal: '120.00',
        imageStoragePath: null,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    addresses: [],
    payments: [{ id: 'pay-9', method: 'CASH_ON_DELIVERY', status: 'PAID', amount: '320.00' }],
    customer: { id: 'u9', email: 'buyer@example.test', firstName: 'Buy', lastName: 'Er', phone: null },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
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

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/orders/order-9']}>
      <Routes>
        <Route path="/orders/:id" element={<OrderDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('OrderDetailPage purchased-variant display', () => {
  it('renders the snapshot image with variant name and SKU from the order record', async () => {
    fetchOrderAdmin.mockResolvedValue(detailFixture());
    renderDetail();

    expect(await screen.findByText('ORD-2026-000009')).toBeInTheDocument();
    expect(screen.getByText('Black')).toBeInTheDocument();
    expect(screen.getByText('SHIRT-BLK')).toBeInTheDocument();
    // Snapshot image resolves from the stored path (never live media).
    const thumb = document.querySelector('img[src*="products/p1/black-primary.webp"]');
    expect(thumb).not.toBeNull();
  });

  it('degrades gracefully for pre-snapshot items without image data', async () => {
    fetchOrderAdmin.mockResolvedValue(detailFixture());
    renderDetail();

    expect(await screen.findByText('WID-OLD')).toBeInTheDocument();
    expect(screen.getByLabelText('No image snapshot for this item')).toBeInTheDocument();
  });
});
