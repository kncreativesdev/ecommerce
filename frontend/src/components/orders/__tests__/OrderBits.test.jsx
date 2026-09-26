import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OrderItemThumb, OrderStatusBadge } from '../OrderBits.jsx';

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
