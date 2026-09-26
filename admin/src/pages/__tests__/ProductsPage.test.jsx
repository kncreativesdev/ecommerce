import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProductsPage } from '../ProductsPage.jsx';
import { useProductStore } from '../../stores/useProductStore.js';
import { useCategoryStore } from '../../stores/useCategoryStore.js';
import { fetchProductImages } from '../../services/media.service.js';

vi.mock('../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

vi.mock('../../services/category.service.js', () => ({
  fetchCategories: vi.fn().mockResolvedValue([]),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/catalog/products']}>
      <Routes>
        <Route path="/catalog/products" element={<ProductsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const PRODUCT = {
  id: 'p1',
  categoryId: 'c1',
  category: { id: 'c1', name: 'Audio', slug: 'audio' },
  name: 'Boom Speaker',
  slug: 'boom-speaker',
  brand: 'Boom',
  isActive: true,
  isFeatured: false,
  variants: [{ id: 'v1', sku: 'S1', name: 'Std', price: '5000.00', isActive: true }],
  createdAt: '2026-09-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  useProductStore.setState({ products: [], status: 'idle', error: null, scope: 'active' });
  useCategoryStore.setState({ categories: [], status: 'idle', error: null, scope: 'active' });
  fetchProductImages.mockResolvedValue([
    { id: 'i1', productId: 'p1', variantId: 'v1', storagePath: 'products/p1/main.webp', sortOrder: 0, isPrimary: true },
  ]);
});

describe('ProductsPage row main image', () => {
  it("shows the product's default image immediately before the product name", async () => {
    useProductStore.setState({ products: [PRODUCT], status: 'success', error: null });
    const { container } = renderPage();
    expect(await screen.findByText('Boom Speaker')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(container.querySelector('img').getAttribute('src')).toContain('products/p1/main.webp');
  });

  it('falls back gracefully when the product has no images', async () => {
    fetchProductImages.mockResolvedValue([]);
    useProductStore.setState({ products: [{ ...PRODUCT, id: 'p-empty' }], status: 'success', error: null });
    const { container } = renderPage();
    expect(await screen.findByText('Boom Speaker')).toBeInTheDocument();
    await waitFor(() => expect(fetchProductImages).toHaveBeenCalledWith('p-empty'));
    expect(container.querySelector('img')).toBeNull();
  });
});
