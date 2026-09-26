import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HeroCarousel } from '../HeroCarousel.jsx';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

function watchProduct(overrides = {}) {
  return {
    id: 'p-yo',
    name: 'Yo Watch',
    slug: 'yo-watch',
    brand: 'King',
    category: { id: 'c-w', name: 'Watches', slug: 'watches' },
    shortDescription: 'You can see time',
    isActive: true,
    isFeatured: true,
    variants: [
      { id: 'v-yo', productId: 'p-yo', sku: 'sku1', name: 'silver', price: '1000.00', compareAtPrice: '1200.00', isActive: true },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const goldenWatch = () =>
  watchProduct({
    id: 'p-golden',
    name: 'Golden Watch',
    slug: 'cool-watchh',
    variants: [
      { id: 'v-golden', productId: 'p-golden', sku: 'sku2', name: 'Golden Black', price: '5000.00', compareAtPrice: null, isActive: true },
    ],
  });

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  fetchProductImages.mockImplementation((productId) =>
    Promise.resolve([
      {
        id: `img-${productId}`,
        storagePath: `products/${productId}/img.webp`,
        sortOrder: 0,
        isPrimary: true,
        variantId: null,
      },
    ]),
  );
});

function renderHero() {
  return render(
    <MemoryRouter>
      <HeroCarousel products={[watchProduct(), goldenWatch()]} />
    </MemoryRouter>,
  );
}

function swipeLeft(viewport) {
  fireEvent.touchStart(viewport, { touches: [{ clientX: 200, clientY: 100 }] });
  fireEvent.touchEnd(viewport, { changedTouches: [{ clientX: 100, clientY: 105 }] });
}

function swipeRight(viewport) {
  fireEvent.touchStart(viewport, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchEnd(viewport, { changedTouches: [{ clientX: 200, clientY: 102 }] });
}

describe('HeroCarousel touch swipe', () => {
  it('swiping left advances and swiping right goes back (dots stay accurate)', async () => {
    const { container } = renderHero();
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });
    const viewport = container.querySelector('[data-testid="hero-carousel-viewport"]');
    expect(viewport).not.toBeNull();

    expect(screen.getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-hidden', 'false');
    swipeLeft(viewport);
    expect(screen.getByRole('group', { name: '2 of 2' })).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByRole('button', { name: /Go to slide 2/ })).toHaveAttribute('aria-current', 'true');

    swipeRight(viewport);
    expect(screen.getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByRole('button', { name: /Go to slide 1/ })).toHaveAttribute('aria-current', 'true');
  });

  it('ignores vertical drags (no page-scroll hijack) and short taps', async () => {
    const { container } = renderHero();
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });
    const viewport = container.querySelector('[data-testid="hero-carousel-viewport"]');

    // Vertical-dominant gesture: no slide change.
    fireEvent.touchStart(viewport, { touches: [{ clientX: 150, clientY: 100 }] });
    fireEvent.touchEnd(viewport, { changedTouches: [{ clientX: 155, clientY: 200 }] });
    expect(screen.getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-hidden', 'false');

    // Short tap: no slide change.
    fireEvent.touchStart(viewport, { touches: [{ clientX: 150, clientY: 100 }] });
    fireEvent.touchEnd(viewport, { changedTouches: [{ clientX: 140, clientY: 100 }] });
    expect(screen.getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-hidden', 'false');
  });

  it('keeps prev/next working after swipes and exposes swipe-friendly touch action', async () => {
    const { container } = renderHero();
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });
    const viewport = container.querySelector('[data-testid="hero-carousel-viewport"]');
    expect(viewport.className).toMatch(/touch-pan-y/);

    swipeLeft(viewport);
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }));
    expect(screen.getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-hidden', 'false');
  });

  it('gives pagination dots top spacing from hero content', async () => {
    const { container } = renderHero();
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });
    const dots = container.querySelector('[aria-label="Choose slide"]');
    expect(dots).not.toBeNull();
    expect(dots.className).toMatch(/mt-4/);
  });
});
