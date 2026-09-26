import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CategoryThumb } from '../CategoryThumb.jsx';
import { ProductThumb } from '../ProductThumb.jsx';
import { OrderItemThumb } from '../../orders/OrderItemThumb.jsx';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CategoryThumb', () => {
  it('renders the backend category image when available', () => {
    const { container } = render(<CategoryThumb image="categories/audio.webp" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toContain('categories/audio.webp');
  });

  it('falls back gracefully when the image is missing or broken', () => {
    const { container, rerender } = render(<CategoryThumb image={null} />);
    expect(container.querySelector('img')).toBeNull();

    rerender(<CategoryThumb image="categories/audio.webp" />);
    const img = container.querySelector('img');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('ProductThumb (default-variant rule)', () => {
  const product = {
    id: 'p1',
    name: 'Gadget',
    variants: [
      { id: 'v1', sku: 'A', isActive: true },
      { id: 'v2', sku: 'B', isActive: true },
    ],
  };
  const images = [
    { id: 'i-b', productId: 'p1', variantId: 'v2', storagePath: 'products/p1/b.webp', sortOrder: 0, isPrimary: true },
    { id: 'i-a', productId: 'p1', variantId: 'v1', storagePath: 'products/p1/a.webp', sortOrder: 0, isPrimary: true },
  ];

  it("picks the default variant's image, never a sibling variant's", async () => {
    fetchProductImages.mockResolvedValue(images);
    const { container } = render(<ProductThumb product={product} />);
    expect(fetchProductImages).toHaveBeenCalledWith('p1');
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    const img = container.querySelector('img');
    // Default variant = first active (v1) → its primary, not v2's.
    expect(img.getAttribute('src')).toContain('products/p1/a.webp');
  });

  it('falls back gracefully when the product has no images', async () => {
    fetchProductImages.mockResolvedValue([]);
    // Fresh product id: the thumb caches one image-list per product id.
    const { container } = render(<ProductThumb product={{ ...product, id: 'p-empty' }} />);
    // Allow the async resolve to settle; no <img> must appear.
    await waitFor(() => expect(fetchProductImages).toHaveBeenCalledWith('p-empty'));
    await waitFor(() => expect(container.querySelector('img')).toBeNull());
  });
});

describe('OrderItemThumb (immutable snapshot)', () => {
  it('renders the snapshot storage path', () => {
    const { container } = render(<OrderItemThumb imageStoragePath="order-items/snap.webp" label="Order ORD-1" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toContain('order-items/snap.webp');
  });

  it('falls back gracefully when the snapshot is missing', () => {
    render(<OrderItemThumb imageStoragePath={null} label="Order ORD-1" />);
    expect(screen.getByLabelText('No image snapshot for Order ORD-1')).toBeInTheDocument();
  });
});
