import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductCard } from '../ProductCard.jsx';
import { ProductGallery } from '../ProductGallery.jsx';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

const PRODUCT = {
  id: 'p',
  name: 'Tall Portrait Gadget',
  slug: 'tall-gadget',
  brand: 'Tech Pulse',
  isActive: true,
  isFeatured: false,
  variants: [
    { id: 'v-a', productId: 'p', sku: 'TALL-1', name: 'Std', price: '999.00', compareAtPrice: null, isActive: true, inStock: true },
  ],
};

const IMAGES = [
  { id: 'a1', productId: 'p', variantId: 'v-a', filename: 'tall.webp', storagePath: 'products/p/tall.webp', imageType: 'webp', altText: 'Tall', sortOrder: 0, isPrimary: true },
  { id: 'a2', productId: 'p', variantId: 'v-a', filename: 'wide.webp', storagePath: 'products/p/wide.webp', imageType: 'webp', altText: 'Wide', sortOrder: 1, isPrimary: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  fetchProductImages.mockResolvedValue(IMAGES);
});

describe('product card presentation (intentional cover)', () => {
  it('card image uses object-cover without changing card layout or fallback', async () => {
    render(
      <MemoryRouter>
        <ProductCard product={PRODUCT} />
      </MemoryRouter>,
    );
    const img = await screen.findByAltText('Tall Portrait Gadget');
    expect(img.className).toMatch(/object-cover/);
  });
});

describe('PDP gallery media is never cropped', () => {

  it('PDP main image and thumbnails use non-cropping presentation', async () => {
    const { container } = render(<ProductGallery productId="p" productName="Tall" variantId="v-a" />);
    const main = await screen.findByAltText('Tall');
    expect(main.className).toMatch(/object-contain/);
    const thumbs = container.querySelectorAll('ul[aria-label="Product images"] img');
    expect(thumbs.length).toBeGreaterThan(0);
    for (const thumb of thumbs) {
      expect(thumb.className).toMatch(/object-contain/);
    }
  });

  it('selected thumbnail stays identifiable, spaced, and keyboard-accessible', async () => {
    const { container } = render(<ProductGallery productId="p" productName="Tall" variantId="v-a" />);
    await screen.findByAltText('Tall');
    const active = container.querySelector('button[aria-current="true"]');
    expect(active).not.toBeNull();
    // Inner padding keeps the selected ring off the image (no clipped border).
    expect(active.className).toMatch(/p-1/);
    expect(active.className).toMatch(/ring-2/);
    expect(active.getAttribute('type')).toBe('button');
    expect(active.getAttribute('aria-label')).toMatch(/View image/);
  });
});
