import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductRail } from '../ProductRail.jsx';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

const PRODUCTS = [
  {
    id: 'p1',
    name: 'Alpha Speaker',
    slug: 'alpha',
    brand: 'Tech',
    isActive: true,
    variants: [{ id: 'v1', productId: 'p1', sku: 'A1', name: 'Std', price: '100.00', compareAtPrice: null, isActive: true, inStock: true }],
  },
  {
    id: 'p2',
    name: 'Beta Speaker',
    slug: 'beta',
    brand: 'Tech',
    isActive: true,
    variants: [{ id: 'v2', productId: 'p2', sku: 'B1', name: 'Std', price: '200.00', compareAtPrice: null, isActive: true, inStock: true }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  fetchProductImages.mockResolvedValue([]);
});

describe('ProductRail horizontal scroll + hidden scrollbar', () => {
  it('keeps native horizontal scrolling enabled while hiding the visible scrollbar', () => {
    const { container } = render(
      <MemoryRouter>
        <ProductRail id="rail-test" title="Featured" products={PRODUCTS} />
      </MemoryRouter>,
    );
    const track = container.querySelector('[data-testid="product-rail-track"]');
    expect(track).not.toBeNull();
    // Scrolling stays enabled (never overflow-hidden).
    expect(track.className).toMatch(/overflow-x-auto/);
    expect(track.className).not.toMatch(/overflow-hidden/);
    // Visible scrollbar hidden via scoped class only.
    expect(track.className).toMatch(/tp-no-scrollbar/);
    expect(screen.getByText('Alpha Speaker')).toBeInTheDocument();
  });
});
