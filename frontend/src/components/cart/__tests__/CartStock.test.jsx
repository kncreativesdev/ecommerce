import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CartLine } from '../CartLine.jsx';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, resolveImageUrl: () => null, fetchProductImages: vi.fn().mockResolvedValue([]) };
});

function lineWithStock(inStock) {
  return {
    id: 'line-1',
    variantId: 'v1',
    quantity: 1,
    unitPrice: '500.00',
    lineTotal: '500.00',
    inStock,
    variant: { id: 'v1', sku: 'SKU1', name: 'Std', price: '500.00', isActive: true, inStock },
    product: { id: 'p1', name: 'Stocked Gadget', slug: 'stocked', isActive: true },
    image: null,
  };
}

function renderLine(line) {
  return render(
    <MemoryRouter>
      <ul>
        <CartLine line={line} pending={false} onSetQuantity={vi.fn()} onRemove={vi.fn()} />
      </ul>
    </MemoryRouter>,
  );
}

describe('CartLine stock state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows In Stock for available lines', () => {
    renderLine(lineWithStock(true));
    expect(screen.getByText('In Stock')).toBeInTheDocument();
  });

  it('shows Out of Stock for unavailable lines', () => {
    renderLine(lineWithStock(false));
    expect(screen.getByText('Out of Stock')).toBeInTheDocument();
  });
});
