import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductGallery } from '../ProductGallery.jsx';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

const IMAGES = [
  { id: 'p1', productId: 'p', variantId: null, filename: 'hero.webp', storagePath: 'products/p/hero.webp', imageType: 'webp', altText: 'Hero', sortOrder: 0, isPrimary: true },
  { id: 'a1', productId: 'p', variantId: 'v-a', filename: 'a-black.webp', storagePath: 'products/p/a-black.webp', imageType: 'webp', altText: 'Black', sortOrder: 0, isPrimary: true },
  { id: 'a2', productId: 'p', variantId: 'v-a', filename: 'a-alt.webp', storagePath: 'products/p/a-alt.webp', imageType: 'webp', altText: 'Black alt', sortOrder: 1, isPrimary: false },
  { id: 'b1', productId: 'p', variantId: 'v-b', filename: 'b-blue.webp', storagePath: 'products/p/b-blue.webp', imageType: 'webp', altText: 'Blue', sortOrder: 0, isPrimary: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  fetchProductImages.mockResolvedValue(IMAGES);
});

describe('ProductGallery variant switching', () => {
  it('shows the selected variant gallery, never another variant’s images', async () => {
    const { rerender } = render(<ProductGallery productId="p" productName="Shirt" variantId="v-a" />);

    const mainA = await screen.findByAltText('Black');
    expect(mainA).toHaveAttribute('src', expect.stringContaining('a-black.webp'));
    expect(screen.getByRole('button', { name: 'View image 2 of 2' })).toBeInTheDocument();
    expect(fetchProductImages).toHaveBeenCalledTimes(1);

    // Switching variants swaps the gallery with NO new request.
    rerender(<ProductGallery productId="p" productName="Shirt" variantId="v-b" />);
    expect(await screen.findByAltText('Blue')).toBeInTheDocument();
    expect(screen.queryByAltText('Black')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View image 2 of 2' })).not.toBeInTheDocument();
    expect(fetchProductImages).toHaveBeenCalledTimes(1);
  });

  it('falls back to product-level images for variants without media', async () => {
    render(<ProductGallery productId="p" productName="Shirt" variantId="v-unknown" />);

    expect(await screen.findByAltText('Hero')).toBeInTheDocument();
    expect(screen.queryByAltText('Black')).not.toBeInTheDocument();
  });
});
