import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductImage } from '../ProductImage.jsx';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

const IMAGES = [
  { id: 'p1', productId: 'p', variantId: null, filename: 'hero.webp', storagePath: 'products/p/hero.webp', imageType: 'webp', altText: 'Hero', sortOrder: 0, isPrimary: true },
  { id: 'a1', productId: 'p', variantId: 'v-a', filename: 'a-black.webp', storagePath: 'products/p/a-black.webp', imageType: 'webp', altText: 'Black', sortOrder: 0, isPrimary: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  fetchProductImages.mockResolvedValue(IMAGES);
});

describe('ProductImage variant scoping', () => {
  it('renders the variant primary image when variantId matches', async () => {
    render(<ProductImage productId="p" variantId="v-a" alt="Shirt" />);
    const img = await screen.findByAltText('Shirt');
    expect(img).toHaveAttribute('src', expect.stringContaining('a-black.webp'));
  });

  it('falls back to the product primary image without a variant match', async () => {
    render(<ProductImage productId="p" alt="Shirt" />);
    const img = await screen.findByAltText('Shirt');
    expect(img).toHaveAttribute('src', expect.stringContaining('hero.webp'));
  });
});
