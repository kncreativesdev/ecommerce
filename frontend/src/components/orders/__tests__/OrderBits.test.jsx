import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OrderCoupon, OrderItemThumb, OrderStatusBadge } from '../OrderBits.jsx';

function renderThumb(item) {
  return render(
    <MemoryRouter>
      <OrderItemThumb item={item} />
    </MemoryRouter>,
  );
}

describe('OrderItemThumb', () => {
  it('resolves the immutable snapshot path', () => {
    renderThumb({ imageStoragePath: 'products/p/black-primary.webp' });
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toContain('products/p/black-primary.webp');
  });

  it('renders a neutral placeholder for pre-snapshot (null) items', () => {
    renderThumb({ imageStoragePath: null });
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('No image recorded for this item')).toBeInTheDocument();
  });
});

describe('OrderStatusBadge friendly labels', () => {
  const cases = [
    ['PENDING', 'Order Placed'],
    ['CONFIRMED', 'Order Confirmed'],
    ['PROCESSING', 'Preparing Your Order'],
    ['SHIPPED', 'Shipped from Store'],
    ['DISPATCHED', 'Shipped from Store'],
    ['IN_TRANSIT', 'On the Way'],
    ['ARRIVED_IN_CITY', 'Arrived in Your City'],
    ['OUT_FOR_DELIVERY', 'Out for Delivery'],
    ['DELIVERED', 'Delivered'],
    ['COMPLETED', 'Order Completed'],
    ['CANCELLED', 'Cancelled'],
  ];

  for (const [status, label] of cases) {
    it(`labels ${status} as "${label}"`, () => {
      render(<OrderStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  }

  it('passes unknown statuses through instead of blanking', () => {
    render(<OrderStatusBadge status="MYSTERY" />);
    expect(screen.getByText('MYSTERY')).toBeInTheDocument();
  });
});

describe('OrderCoupon', () => {
  function renderCoupon(order) {
    return render(
      <MemoryRouter>
        <OrderCoupon order={order} />
      </MemoryRouter>,
    );
  }

  it('shows code, offer, description, and saved amount for a percentage coupon', () => {
    renderCoupon({
      discountTotal: '20.00',
      coupon: { id: 'c1', code: 'SAVE10', description: '10% off sitewide', discountType: 'PERCENTAGE', discountValue: '10.00' },
    });
    const block = screen.getByRole('group', { name: 'Coupon applied' });
    expect(within(block).getByText('SAVE10')).toBeInTheDocument();
    // The offer line and the description both contain "10% off" — assert
    // each in its exact element.
    expect(within(block).getByText('· 10% off')).toBeInTheDocument();
    expect(within(block).getByText('10% off sitewide')).toBeInTheDocument();
    expect(within(block).getByText(/You saved/)).toBeInTheDocument();
  });

  it('shows a money offer for a fixed-amount coupon without a description', () => {
    renderCoupon({
      discountTotal: '150.00',
      coupon: { id: 'c2', code: 'FLAT150', description: null, discountType: 'FIXED', discountValue: '150.00' },
    });
    const block = screen.getByRole('group', { name: 'Coupon applied' });
    expect(within(block).getByText('FLAT150')).toBeInTheDocument();
    // Offer ("₹150.00 off") and savings ("You saved −₹150.00") share the
    // amount — assert each exact text.
    expect(within(block).getByText(/₹150\.00 off/)).toBeInTheDocument();
    expect(within(block).getByText(/You saved/)).toBeInTheDocument();
  });

  it('renders nothing when the order used no coupon', () => {
    const { container } = renderCoupon({ discountTotal: '0.00', coupon: null });
    expect(container).toBeEmptyDOMElement();
    const { container: legacy } = renderCoupon({ discountTotal: '0.00' });
    expect(legacy).toBeEmptyDOMElement();
  });
});
