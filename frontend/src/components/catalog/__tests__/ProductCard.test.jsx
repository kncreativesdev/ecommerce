import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductCard } from '../ProductCard.jsx';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

const PRODUCT = {
  id: 'p',
  name: 'Test Speaker',
  slug: 'test-speaker',
  brand: 'Tech Pulse',
  isActive: true,
  isFeatured: false,
  variants: [
    { id: 'v-a', productId: 'p', sku: 'SPK-BLK', name: 'Black', price: '1299.00', compareAtPrice: null, isActive: true },
    { id: 'v-b', productId: 'p', sku: 'SPK-BLU', name: 'Blue', price: '1399.00', compareAtPrice: null, isActive: true },
  ],
};

const IMAGES = [
  { id: 'a-1', productId: 'p', variantId: 'v-a', filename: 'blk1.webp', storagePath: 'products/p/blk1.webp', imageType: 'webp', altText: 'Black', sortOrder: 0, isPrimary: true },
  { id: 'a-2', productId: 'p', variantId: 'v-a', filename: 'blk2.webp', storagePath: 'products/p/blk2.webp', imageType: 'webp', altText: 'Black alt', sortOrder: 1, isPrimary: false },
  { id: 'b-1', productId: 'p', variantId: 'v-b', filename: 'blu1.webp', storagePath: 'products/p/blu1.webp', imageType: 'webp', altText: 'Blue', sortOrder: 0, isPrimary: true },
];

function renderCard(product) {
  return render(
    <MemoryRouter>
      <ProductCard product={product} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchProductImages.mockResolvedValue(IMAGES);
});

describe('ProductCard deterministic image', () => {
  it('renders the default (first active) variant primary image', async () => {
    renderCard(PRODUCT);
    const img = await screen.findByAltText('Test Speaker');
    expect(img).toHaveAttribute('src', expect.stringContaining('blk1.webp'));
  });

  it('never renders another variant image for the default variant', async () => {
    renderCard(PRODUCT);
    const img = await screen.findByAltText('Test Speaker');
    expect(img).not.toHaveAttribute('src', expect.stringContaining('blu1.webp'));
    expect(img).not.toHaveAttribute('src', expect.stringContaining('blk2.webp'));
  });

  it('falls back to the legacy product-level image when the default variant has no images', async () => {
    // Fresh product id: ProductImage caches one GET per product per session.
    const legacyProduct = { ...PRODUCT, id: 'p-legacy' };
    fetchProductImages.mockResolvedValue([
      { id: 'p-1', productId: 'p-legacy', variantId: null, filename: 'hero.webp', storagePath: 'products/p-legacy/hero.webp', imageType: 'webp', altText: 'Hero', sortOrder: 0, isPrimary: true },
    ]);
    renderCard(legacyProduct);
    const img = await screen.findByAltText('Test Speaker');
    expect(img).toHaveAttribute('src', expect.stringContaining('hero.webp'));
  });

  it('does not fetch per variant — one cached request per product', async () => {
    // Fresh product id: earlier tests already warmed the cache for 'p'.
    const freshProduct = { ...PRODUCT, id: 'p-count' };
    renderCard(freshProduct);
    await screen.findByAltText('Test Speaker');
    expect(fetchProductImages).toHaveBeenCalledTimes(1);
    expect(fetchProductImages).toHaveBeenCalledWith('p-count');
  });
});
