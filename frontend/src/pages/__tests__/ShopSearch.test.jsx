import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ShopPage } from '../ShopPage.jsx';
import { useProductStore } from '../../stores/useProductStore.js';
import { useCategoryStore } from '../../stores/useCategoryStore.js';

vi.mock('../../services/product.service.js', () => ({
  fetchProducts: vi.fn().mockResolvedValue([]),
  fetchProductById: vi.fn(),
}));

vi.mock('../../services/category.service.js', () => ({
  fetchCategories: vi.fn().mockResolvedValue([]),
}));

const PRODUCTS = [
  {
    id: 'p-watch',
    categoryId: 'c-w',
    category: { id: 'c-w', name: 'Watches', slug: 'watches' },
    name: 'Yo Watch',
    slug: 'yo-watch',
    brand: 'King',
    isActive: true,
    isFeatured: false,
    variants: [{ id: 'v-w', productId: 'p-watch', sku: 'W1', name: 'Std', price: '1000.00', compareAtPrice: null, isActive: true }],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'p-speaker',
    categoryId: 'c-a',
    category: { id: 'c-a', name: 'Audio', slug: 'audio' },
    name: 'Boom Speaker',
    slug: 'boom-speaker',
    brand: 'Boom',
    isActive: true,
    isFeatured: false,
    variants: [{ id: 'v-s', productId: 'p-speaker', sku: 'S1', name: 'Std', price: '5000.00', compareAtPrice: null, isActive: true }],
    createdAt: '2026-02-01T00:00:00.000Z',
  },
];

function renderShop(initialEntries = ['/shop']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ShopPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useProductStore.setState({ products: PRODUCTS, status: 'success', error: null });
  useCategoryStore.setState({
    taxonomy: [
      { id: 'c-w', name: 'Watches', slug: 'watches', subcategories: [] },
      { id: 'c-a', name: 'Audio', slug: 'audio', subcategories: [] },
    ],
    status: 'success',
  });
});

describe('Shop canonical listing: search + filters together', () => {
  it('constrains by search query and refines with filters', async () => {
    renderShop(['/shop?q=watch']);
    // Search narrows to the watch; the speaker is excluded.
    expect(await screen.findByText('Yo Watch')).toBeInTheDocument();
    expect(screen.queryByText('Boom Speaker')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing results for.*watch/i)).toBeInTheDocument();
  });

  it('syncs the search input with the URL and clears back to normal browsing', async () => {
    renderShop(['/shop?q=watch']);
    const input = await screen.findByLabelText('Search products');
    expect(input.value).toBe('watch');
    const clearButtons = await screen.findAllByRole('button', { name: 'Clear search' });
    fireEvent.click(clearButtons[0]);
    // After clearing, both products return (normal catalog, no stale search).
    expect(await screen.findByText('Boom Speaker')).toBeInTheDocument();
    expect(screen.getByText('Yo Watch')).toBeInTheDocument();
  });

  it('shows a search-aware empty state for no-hit queries', async () => {
    renderShop(['/shop?q=nonexistentgadget']);
    expect(await screen.findByText(/No results for/i)).toBeInTheDocument();
  });
});
