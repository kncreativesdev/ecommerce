import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProductDetailPage } from '../ProductDetailPage.jsx';
import { useProductStore } from '../../stores/useProductStore.js';
import { fetchProductById, fetchProducts } from '../../services/product.service.js';
import { fetchProductImages } from '../../services/media.service.js';

vi.mock('../../services/product.service.js', () => ({
  fetchProducts: vi.fn(),
  fetchProductById: vi.fn(),
}));

vi.mock('../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

const PRODUCT = {
  id: 'p1',
  categoryId: 'c1',
  category: { id: 'c1', name: 'Audio', slug: 'audio' },
  name: 'Test Shirt',
  slug: 'test-shirt',
  description: null,
  shortDescription: null,
  brand: 'TP',
  isActive: true,
  isFeatured: false,
  variants: [
    { id: 'v-a', productId: 'p1', sku: 'SKU-A', name: 'Black', price: '100.00', compareAtPrice: null, barcode: null, weight: null, isActive: true, createdAt: null, updatedAt: null },
    { id: 'v-b', productId: 'p1', sku: 'SKU-B', name: 'Blue', price: '120.00', compareAtPrice: null, barcode: null, weight: null, isActive: true, createdAt: null, updatedAt: null },
  ],
  createdAt: null,
  updatedAt: null,
};

const IMAGES = [
  { id: 'a1', productId: 'p1', variantId: 'v-a', filename: 'a.webp', storagePath: 'products/p1/a.webp', imageType: 'webp', altText: 'Black shirt', sortOrder: 0, isPrimary: true },
  { id: 'b1', productId: 'p1', variantId: 'v-b', filename: 'b.webp', storagePath: 'products/p1/b.webp', imageType: 'webp', altText: 'Blue shirt', sortOrder: 0, isPrimary: true },
  { id: 'p1i', productId: 'p1', variantId: null, filename: 'hero.webp', storagePath: 'products/p1/hero.webp', imageType: 'webp', altText: 'Hero', sortOrder: 0, isPrimary: true },
];

function resetStores() {
  useProductStore.setState({ products: [], status: 'idle', error: null });
}

function renderPdp() {
  return render(
    <MemoryRouter initialEntries={['/product/p1']}>
      <Routes>
        <Route path="/product/:id" element={<ProductDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStores();
  fetchProducts.mockResolvedValue([]);
  fetchProductById.mockResolvedValue(PRODUCT);
  fetchProductImages.mockResolvedValue(IMAGES);
});

describe('ProductDetailPage variant selection', () => {
  it('shows the default variant gallery, then swaps to the selected variant’s images', async () => {
    const user = userEvent.setup();
    renderPdp();

    // Default variant (first active = Black) drives gallery, price, and SKU.
    expect(await screen.findByAltText('Black shirt')).toBeInTheDocument();
    expect(screen.getByText('SKU-A')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Blue' }));

    // Gallery + price + SKU follow the selection consistently.
    expect(await screen.findByAltText('Blue shirt')).toBeInTheDocument();
    expect(screen.queryByAltText('Black shirt')).not.toBeInTheDocument();
    expect(screen.getByText('SKU-B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true');
    expect(fetchProductImages).toHaveBeenCalledTimes(1);
  });
});
