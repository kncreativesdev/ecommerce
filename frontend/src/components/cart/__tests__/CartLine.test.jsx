import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CartLine } from '../CartLine.jsx';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

function serverLine() {
  return {
    id: 'line-1',
    variantId: 'v-a',
    quantity: 2,
    unitPrice: '100.00',
    lineTotal: '200.00',
    variant: { id: 'v-a', sku: 'SKU-A', name: 'Black' },
    product: { id: 'p', name: 'Test Shirt' },
    // Server-resolved snapshot (variant primary at fetch time).
    image: { storagePath: 'products/p/a-black.webp', altText: 'Black' },
  };
}

function renderLine(line) {
  return render(
    <MemoryRouter>
      <ul>
        <CartLine line={line} pending={false} onSetQuantity={vi.fn()} onRemove={vi.fn()} />
      </ul>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchProductImages.mockResolvedValue([]);
});

describe('CartLine variant image', () => {
  it('renders the server snapshot image with variant name and SKU', () => {
    renderLine(serverLine());
    const img = screen.getByAltText('Black');
    expect(img).toHaveAttribute('src', expect.stringContaining('a-black.webp'));
    expect(screen.getByText('Black')).toBeInTheDocument();
    expect(screen.getByText('SKU: SKU-A')).toBeInTheDocument();
    // No media fetch needed when the snapshot is present.
    expect(fetchProductImages).not.toHaveBeenCalled();
  });

  it('falls back to a variant-aware media read for lines without snapshots', async () => {
    fetchProductImages.mockResolvedValue([
      { id: 'a1', productId: 'p', variantId: 'v-a', filename: 'a-black.webp', storagePath: 'products/p/a-black.webp', imageType: 'webp', altText: null, sortOrder: 0, isPrimary: true },
      { id: 'b1', productId: 'p', variantId: 'v-b', filename: 'b-blue.webp', storagePath: 'products/p/b-blue.webp', imageType: 'webp', altText: null, sortOrder: 0, isPrimary: true },
    ]);
    const line = { ...serverLine(), image: null };
    renderLine(line);
    // Variant A's image — never Variant B's — resolved without a snapshot.
    const img = await screen.findByAltText('Test Shirt');
    expect(img).toHaveAttribute('src', expect.stringContaining('a-black.webp'));
  });
});
