import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { ProductCard } from '../ProductCard.jsx';
import { useCartStore } from '../../../stores/useCartStore.js';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function productWithStock(inStock) {
  return {
    id: 'p-stock',
    name: 'Stocked Gadget',
    slug: 'stocked-gadget',
    brand: 'Tech',
    isActive: true,
    variants: [
      { id: 'v1', productId: 'p-stock', sku: 'SKU1', name: 'Std', price: '500.00', compareAtPrice: null, isActive: true, inStock },
    ],
  };
}

function renderCard(product) {
  return render(
    <MemoryRouter>
      <ProductCard product={product} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchProductImages.mockResolvedValue([]);
  useCartStore.setState({ bulkPending: false, addItem: vi.fn() });
});

describe('ProductCard stock visibility', () => {
  it('shows In Stock for available variants', () => {
    renderCard(productWithStock(true));
    expect(screen.getByText('In Stock')).toBeInTheDocument();
    expect(screen.queryByText('Out of Stock')).not.toBeInTheDocument();
  });

  it('shows Out of Stock for unavailable variants', () => {
    renderCard(productWithStock(false));
    expect(screen.getByText('Out of Stock')).toBeInTheDocument();
    expect(screen.queryByText('In Stock')).not.toBeInTheDocument();
  });
});

describe('ProductCard out-of-stock protection', () => {
  it('blocks the add with an out-of-stock toast without calling the backend', async () => {
    const addItem = vi.fn();
    useCartStore.setState({ bulkPending: false, addItem });
    renderCard(productWithStock(false));
    fireEvent.click(screen.getByRole('button', { name: /Add Stocked Gadget to cart/ }));
    expect(addItem).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/out of stock/i));
  });

  it('surfaces stale backend 409s as out-of-stock toasts', async () => {
    const addItem = vi.fn().mockResolvedValue({ ok: false, error: { code: 'INSUFFICIENT_STOCK', status: 409 } });
    useCartStore.setState({ bulkPending: false, addItem });
    renderCard(productWithStock(true));
    fireEvent.click(screen.getByRole('button', { name: /Add Stocked Gadget to cart/ }));
    await screen.findByText('Stocked Gadget');
    expect(addItem).toHaveBeenCalled();
    // Flush the async handler.
    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/out of stock/i));
    });
  });
});
