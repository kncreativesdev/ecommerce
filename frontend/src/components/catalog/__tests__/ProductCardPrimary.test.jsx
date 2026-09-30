import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductCard } from '../ProductCard.jsx';
import { clearProductImageCache } from '../ProductImage.jsx';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

const PRODUCT = {
  id: 'p-primary-card',
  name: 'Test Speaker',
  slug: 'test-speaker',
  brand: 'Tech Pulse',
  isActive: true,
  isFeatured: false,
  variants: [
    { id: 'v-a', productId: 'p-primary-card', sku: 'SPK-BLK', name: 'Black', price: '1299.00', compareAtPrice: null, isActive: true },
    { id: 'v-b', productId: 'p-primary-card', sku: 'SPK-BLU', name: 'Blue', price: '1399.00', compareAtPrice: null, isActive: true },
  ],
};

function renderCard(product) {
  return render(
    <MemoryRouter>
      <ProductCard product={product} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearProductImageCache();
});

describe('ProductCard product-level primary', () => {
  it('renders the persisted primary even when it belongs to the non-default variant', async () => {
    fetchProductImages.mockResolvedValue([
      { id: 'a-1', productId: PRODUCT.id, variantId: 'v-a', filename: 'blk1.webp', storagePath: 'products/p/blk1.webp', imageType: 'webp', altText: 'Black', sortOrder: 0, isPrimary: false },
      { id: 'b-1', productId: PRODUCT.id, variantId: 'v-b', filename: 'blu1.webp', storagePath: 'products/p/blu1.webp', imageType: 'webp', altText: 'Blue', sortOrder: 0, isPrimary: true },
    ]);
    renderCard(PRODUCT);
    const img = await screen.findByAltText('Test Speaker');
    expect(img).toHaveAttribute('src', expect.stringContaining('blu1.webp'));
  });

  it('falls back deterministically when no primary exists', async () => {
    const fallbackProduct = { ...PRODUCT, id: 'p-primary-fallback' };
    fetchProductImages.mockResolvedValue([
      { id: 'a-1', productId: fallbackProduct.id, variantId: 'v-a', filename: 'blk1.webp', storagePath: 'products/p/blk1.webp', imageType: 'webp', altText: 'Black', sortOrder: 0, isPrimary: false },
      { id: 'b-1', productId: fallbackProduct.id, variantId: 'v-b', filename: 'blu1.webp', storagePath: 'products/p/blu1.webp', imageType: 'webp', altText: 'Blue', sortOrder: 0, isPrimary: false },
    ]);
    renderCard(fallbackProduct);
    const img = await screen.findByAltText('Test Speaker');
    expect(img).toHaveAttribute('src', expect.stringContaining('blk1.webp'));
  });

  it('refreshes the displayed image after the underlying data is refetched', async () => {
    const refreshProduct = { ...PRODUCT, id: 'p-primary-refresh' };
    fetchProductImages.mockResolvedValue([
      { id: 'a-1', productId: refreshProduct.id, variantId: 'v-a', filename: 'blk1.webp', storagePath: 'products/p/blk1.webp', imageType: 'webp', altText: 'Black', sortOrder: 0, isPrimary: true },
      { id: 'b-1', productId: refreshProduct.id, variantId: 'v-b', filename: 'blu1.webp', storagePath: 'products/p/blu1.webp', imageType: 'webp', altText: 'Blue', sortOrder: 0, isPrimary: false },
    ]);
    const { unmount } = render(
      <MemoryRouter>
        <ProductCard product={refreshProduct} />
      </MemoryRouter>,
    );
    expect(await screen.findByAltText('Test Speaker')).toHaveAttribute(
      'src',
      expect.stringContaining('blk1.webp'),
    );
    unmount();

    // Simulate an admin Set-primary to the other variant, then a refetch.
    clearProductImageCache(refreshProduct.id);
    fetchProductImages.mockResolvedValue([
      { id: 'a-1', productId: refreshProduct.id, variantId: 'v-a', filename: 'blk1.webp', storagePath: 'products/p/blk1.webp', imageType: 'webp', altText: 'Black', sortOrder: 0, isPrimary: false },
      { id: 'b-1', productId: refreshProduct.id, variantId: 'v-b', filename: 'blu1.webp', storagePath: 'products/p/blu1.webp', imageType: 'webp', altText: 'Blue', sortOrder: 0, isPrimary: true },
    ]);
    renderCard(refreshProduct);
    expect(await screen.findByAltText('Test Speaker')).toHaveAttribute(
      'src',
      expect.stringContaining('blu1.webp'),
    );
  });
});
