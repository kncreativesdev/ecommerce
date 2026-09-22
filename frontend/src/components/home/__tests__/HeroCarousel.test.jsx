import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HeroCarousel, HERO_AUTOPLAY_MS } from '../HeroCarousel.jsx';
import { fetchProductImages, resolveImageUrl } from '../../../services/media.service.js';
import { env } from '../../../config/env.js';

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
    description: 'desc',
    isActive: true,
    isFeatured: true,
    variants: [
      { id: 'v-yo', productId: 'p-yo', sku: 'egrbrh', name: 'silver', price: '1000.00', compareAtPrice: '1200.00', isActive: true },
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
    shortDescription: 'very nice watch',
    variants: [
      { id: 'v-golden', productId: 'p-golden', sku: 'kfhvoeijro', name: 'Golden Black', price: '5000.00', compareAtPrice: '4500.00', isActive: true },
    ],
  });

const imageFor = (productId, file) => ({
  id: `img-${productId}`,
  filename: file,
  storagePath: `products/${productId}/${file}`,
  imageType: 'webp',
  altText: '',
  sortOrder: 0,
  isPrimary: false,
  variantId: null,
});

const YO_IMG = imageFor('p-yo', 'yo.webp');
const GOLDEN_IMG = imageFor('p-golden', 'golden.webp');

function mockImages(map) {
  fetchProductImages.mockImplementation((productId) =>
    Promise.resolve(map[productId] ?? []),
  );
}

function renderHero(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

/** All slide nodes including aria-hidden inactive ones (role queries skip those). */
function slideNodes(container) {
  return container.querySelectorAll('[aria-roledescription="slide"]');
}

function productLinks(container) {
  return container.querySelectorAll('a[href^="/product/"]');
}

/** Only the hero's own autoplay timers (RTL's findBy polling uses its own intervals). */
function autoplayIntervalCalls() {
  return setIntervalSpy.mock.calls.filter((call) => call[1] === HERO_AUTOPLAY_MS);
}

/** Timer ids (return values) of the hero's autoplay intervals. */
function autoplayTimerIds() {
  const { calls, results } = setIntervalSpy.mock;
  const ids = [];
  calls.forEach((call, index) => {
    if (call[1] === HERO_AUTOPLAY_MS && results[index]?.type === 'return') {
      ids.push(results[index].value);
    }
  });
  return ids;
}

/** Ids currently cleared. */
function clearedTimerIds() {
  return new Set(clearIntervalSpy.mock.calls.map((call) => call[0]));
}

/**
 * Spies must wrap the FAKE timers, so they are installed after
 * vi.useFakeTimers(). The beforeEach spies (on the real timers) are left in
 * place — the next beforeEach restores everything — and calls are always
 * filtered to the hero's own delay (see autoplayIntervalCalls), so RTL's
 * internal polling never pollutes the assertions.
 */
function spyFakeTimers() {
  setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
  clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
}

function matchMediaMock(matches) {
  const listeners = new Set();
  return vi.fn().mockImplementation(() => ({
    matches,
    addEventListener: vi.fn((_, handler) => listeners.add(handler)),
    removeEventListener: vi.fn((_, handler) => listeners.delete(handler)),
  }));
}

let setIntervalSpy;
let clearIntervalSpy;

beforeEach(() => {
  setIntervalSpy?.mockRestore();
  clearIntervalSpy?.mockRestore();
  vi.clearAllMocks();
  vi.useRealTimers();
  window.matchMedia = matchMediaMock(false);
  setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
  clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
  mockImages({ 'p-yo': [YO_IMG], 'p-golden': [GOLDEN_IMG] });
});

afterEach(() => {
  setIntervalSpy?.mockRestore();
  clearIntervalSpy?.mockRestore();
  vi.useRealTimers();
});

describe('HeroCarousel slide sourcing (real media only)', () => {
  it('renders the 2 real watch slides with resolver-built URLs and no third slide', async () => {
    const { container } = renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);

    expect(await screen.findByRole('heading', { name: 'Everyday time, done right.' })).toBeInTheDocument();
    expect(slideNodes(container)).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Go to slide/ })).toHaveLength(2);
    expect(container.querySelector('[aria-label="3 of 3"]')).not.toBeInTheDocument();

    const images = container.querySelectorAll('img');
    // Per slide: one dimmed atmospheric background image plus one
    // foreground showcase image — same real URL, never a third asset.
    expect(images).toHaveLength(4);
    for (const img of images) {
      expect(img.getAttribute('src')).toMatch(/^https?:\/\//);
      expect(img.getAttribute('src').startsWith(env.mediaBaseUrl)).toBe(true);
      expect(img.getAttribute('src').startsWith('data:')).toBe(false);
    }
    const background = [...images].filter((img) => img.getAttribute('alt') === '');
    const foreground = [...images].filter((img) => img.getAttribute('alt') !== '');
    expect(background).toHaveLength(2);
    expect(foreground).toHaveLength(2);
    expect(foreground[0].getAttribute('alt')).toBe('Yo Watch product photo');
    expect(foreground[0].getAttribute('src')).toContain('products/p-yo/yo.webp');
    expect(foreground[1].getAttribute('alt')).toBe('Golden Watch product photo');
    expect(foreground[1].getAttribute('src')).toContain('products/p-golden/golden.webp');
    // No external hosts, no data URIs, no duplicated slide.
    expect(fetchProductImages).toHaveBeenCalledTimes(2);
  });

  it('calls the shared image resolver with the real image records', async () => {
    renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });
    // Resolver output lands on the <img> (proves the shared resolver built it).
    expect(resolveImageUrl(YO_IMG, env.mediaBaseUrl)).toContain('products/p-yo/yo.webp');
    expect(screen.getAllByRole('img')[0].getAttribute('src')).toBe(
      resolveImageUrl(YO_IMG, env.mediaBaseUrl),
    );
  });

  it('renders one slide and no controls or timer for a single valid image', async () => {
    mockImages({ 'p-yo': [YO_IMG] });
    const { container } = renderHero(<HeroCarousel products={[watchProduct()]} />);

    expect(await screen.findByRole('group', { name: '1 of 1' })).toBeInTheDocument();
    expect(slideNodes(container)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Go to slide/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous slide' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next slide' })).not.toBeInTheDocument();
    expect(autoplayIntervalCalls()).toHaveLength(0);
  });

  it('renders three slides when three valid images exist', async () => {
    const third = watchProduct({ id: 'p-third', name: 'Sport Watch', slug: 'sport-watch' });
    mockImages({ 'p-yo': [YO_IMG], 'p-golden': [GOLDEN_IMG], 'p-third': [imageFor('p-third', 'sport.webp')] });
    const { container } = renderHero(<HeroCarousel products={[watchProduct(), goldenWatch(), third]} />);

    await screen.findByRole('group', { name: '1 of 3' });
    expect(slideNodes(container)).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /Go to slide/ })).toHaveLength(3);
  });

  it('drops a product with no usable image instead of inventing a slide', async () => {
    mockImages({ 'p-yo': [YO_IMG], 'p-golden': [] });
    renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);

    expect(await screen.findByRole('group', { name: '1 of 1' })).toBeInTheDocument();
    expect(screen.queryByText('Golden Black, made for every day.')).not.toBeInTheDocument();
  });

  it('shows the loading state while the catalog is still arriving', () => {
    renderHero(<HeroCarousel products={[]} isLoading />);
    expect(screen.getByRole('status', { name: 'Loading featured watches' })).toBeInTheDocument();
  });

  it('renders the static fallback (not a spinner) when no watch products exist', async () => {
    renderHero(
      <HeroCarousel
        products={[watchProduct({ id: 'p-cable', name: 'SyncLine USB-C Cable', slug: 'cable' })]}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Premium electronics, honestly priced.' })).toBeInTheDocument();
    expect(fetchProductImages).not.toHaveBeenCalled();
  });
});

describe('HeroCarousel controls (deterministic)', () => {
  it('starts on slide 1 and moves with next/previous, wrapping around', async () => {
    renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });

    expect(screen.getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByRole('button', { name: /Go to slide 1/ })).toHaveAttribute('aria-current', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByRole('group', { name: '2 of 2' })).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByRole('button', { name: /Go to slide 2/ })).toHaveAttribute('aria-current', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-hidden', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }));
    expect(screen.getByRole('group', { name: '2 of 2' })).toHaveAttribute('aria-hidden', 'false');
  });

  it('jumps directly via dots', async () => {
    renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });

    fireEvent.click(screen.getByRole('button', { name: /Go to slide 2/ }));
    expect(screen.getByRole('group', { name: '2 of 2' })).toHaveAttribute('aria-hidden', 'false');

    fireEvent.click(screen.getByRole('button', { name: /Go to slide 1/ }));
    expect(screen.getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-hidden', 'false');
  });

  it('points each CTA at the real React Router product route', async () => {
    const { container } = renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });

    // Per slide: "Buy Now" plus showcase "View Product", both derived
    // from the same slide product (slide order preserved).
    const links = productLinks(container);
    expect(links).toHaveLength(4);
    expect(links[0].getAttribute('href')).toBe('/product/p-yo');
    expect(links[1].getAttribute('href')).toBe('/product/p-yo');
    expect(links[2].getAttribute('href')).toBe('/product/p-golden');
    expect(links[3].getAttribute('href')).toBe('/product/p-golden');

    // Primary collection CTA routes to the real shop in every slide.
    const shopLinks = container.querySelectorAll('a[href="/shop"]');
    expect(shopLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('uses real buttons with accessible labels (no div click handlers, no reload)', async () => {
    renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });

    const hrefBefore = window.location.href;
    for (const button of screen.getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(window.location.href).toBe(hrefBefore);
  });
});

describe('HeroCarousel autoplay (fake timers)', () => {
  async function renderReady() {
    vi.useFakeTimers();
    spyFakeTimers();
    renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await act(async () => {});
    expect(screen.getByRole('group', { name: '1 of 2' })).toBeInTheDocument();
  }

  it(`advances every ${HERO_AUTOPLAY_MS}ms and loops forever`, async () => {
    expect(HERO_AUTOPLAY_MS).toBeGreaterThanOrEqual(4000);
    expect(HERO_AUTOPLAY_MS).toBeLessThanOrEqual(6000);
    await renderReady();

    await act(async () => { vi.advanceTimersByTime(HERO_AUTOPLAY_MS); });
    expect(screen.getByRole('group', { name: '2 of 2' })).toHaveAttribute('aria-hidden', 'false');

    await act(async () => { vi.advanceTimersByTime(HERO_AUTOPLAY_MS); });
    expect(screen.getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-hidden', 'false');
  });

  it('keeps exactly one live timer across advances and manual navigation', async () => {
    await renderReady();
    // Behavioral proof of a single timer: one window advances exactly one
    // slide (two stacked timers would land back on slide 1).
    await act(async () => { vi.advanceTimersByTime(HERO_AUTOPLAY_MS); });
    expect(screen.getByRole('group', { name: '2 of 2' })).toHaveAttribute('aria-hidden', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    fireEvent.click(screen.getByRole('button', { name: /Go to slide 1/ }));

    const createdIds = autoplayTimerIds();
    const clearedIds = clearedTimerIds();
    // Manual navigation restarts (never stacks) the interval: every created
    // timer except the current one was cleared.
    expect(createdIds.length).toBeGreaterThanOrEqual(1);
    expect(createdIds.filter((id) => !clearedIds.has(id))).toHaveLength(1);

    await act(async () => { vi.advanceTimersByTime(HERO_AUTOPLAY_MS); });
    expect(screen.getByRole('group', { name: '2 of 2' })).toHaveAttribute('aria-hidden', 'false');
  });

  it('cleans the timer up on unmount', async () => {
    vi.useFakeTimers();
    spyFakeTimers();
    const rendered = renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await act(async () => {});
    const createdIds = autoplayTimerIds();
    expect(createdIds.length).toBeGreaterThanOrEqual(1);

    rendered.unmount();
    const clearedIds = clearedTimerIds();
    for (const id of createdIds) {
      expect(clearedIds.has(id)).toBe(true);
    }
  });

  it('pauses while hovered or focused and resumes after', async () => {
    await renderReady();
    const section = screen.getByRole('region', { name: 'Featured watches' });

    fireEvent.mouseEnter(section);
    await act(async () => { vi.advanceTimersByTime(HERO_AUTOPLAY_MS * 3); });
    expect(screen.getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-hidden', 'false');

    fireEvent.mouseLeave(section);
    await act(async () => { vi.advanceTimersByTime(HERO_AUTOPLAY_MS); });
    expect(screen.getByRole('group', { name: '2 of 2' })).toHaveAttribute('aria-hidden', 'false');
  });
});

describe('HeroCarousel reduced motion + image failure', () => {
  it('disables autoplay but keeps working controls under reduced motion', async () => {
    window.matchMedia = matchMediaMock(true);
    vi.useFakeTimers();
    spyFakeTimers();
    renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await act(async () => {});
    expect(screen.getByRole('group', { name: '1 of 2' })).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(HERO_AUTOPLAY_MS * 3); });
    expect(screen.getByRole('group', { name: '1 of 2' })).toHaveAttribute('aria-hidden', 'false');
    expect(autoplayIntervalCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByRole('group', { name: '2 of 2' })).toHaveAttribute('aria-hidden', 'false');
  });

  it('drops a failed image slide instead of showing a broken image', async () => {
    renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });

    fireEvent.error(screen.getAllByRole('img')[0]);
    expect(await screen.findByRole('group', { name: '1 of 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Go to slide/ })).not.toBeInTheDocument();
  });

  it('falls back to the static hero when every watch image fails', async () => {
    const { container } = renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });

    // Both slide images fail (inactive slides are aria-hidden but still in the DOM).
    await act(async () => {
      for (const img of container.querySelectorAll('img')) fireEvent.error(img);
    });
    expect(await screen.findByRole('heading', { name: 'Premium electronics, honestly priced.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Shop all products' })).toHaveAttribute('href', '/shop');
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('keeps the hero inside the viewport (no horizontal overflow)', async () => {
    renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });
    expect(screen.getByRole('region', { name: 'Featured watches' }).className).toMatch(/overflow-hidden/);
  });
});

describe('HeroCarousel reference composition', () => {
  const activeSlide = (container) =>
    container.querySelector('[aria-roledescription="slide"][aria-hidden="false"]');
  const foregroundOf = (slide, name) => slide.querySelector(`img[alt="${name} product photo"]`);

  it('renders the dark hero with background atmosphere + showcase glow per slide', async () => {
    const { container } = renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });

    const section = screen.getByRole('region', { name: 'Featured watches' });
    expect(section.className).toMatch(/bg-header/);
    for (const slide of slideNodes(container)) {
      // Atmospheric background: same real slide URL, dimmed, hidden from AT.
      const bg = slide.querySelector('img[alt=""]');
      expect(bg).not.toBeNull();
      expect(bg.getAttribute('src')).toContain('products/');
      // Decorative red glow behind the showcase: present, non-interactive.
      const glow = slide.querySelector('[aria-hidden="true"].pointer-events-none[class*="blur-3xl"]');
      expect(glow).not.toBeNull();
    }
  });

  it('renders left content: badge, dual CTAs, and verified trust indicators', async () => {
    const { container } = renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });

    expect(screen.getAllByText('Premium Wearables')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Buy Now/ })).toHaveAttribute('href', '/product/p-yo');
    expect(screen.getByRole('link', { name: /Explore Collection/ })).toHaveAttribute('href', '/shop');
    expect(container.querySelector('a[href="/product/p-yo"]')).not.toBeNull();
    // Only project-established claims (mirrors the homepage trust strip).
    for (const label of ['Cash on Delivery', 'Genuine products', 'Support that replies']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('keeps background, showcase, name, price, and CTA synchronized with the slide', async () => {
    const { container } = renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });

    let active = activeSlide(container);
    expect(foregroundOf(active, 'Yo Watch').getAttribute('src')).toContain('products/p-yo/yo.webp');
    expect(active.textContent).toMatch(/Yo Watch/);
    expect(active.textContent).toMatch(/₹1,000\.00/);

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByRole('group', { name: '2 of 2' })).toHaveAttribute('aria-hidden', 'false');
    // Background, foreground, name, price, and product CTA all switched.
    active = activeSlide(container);
    expect(active.querySelector('img[alt=""]').getAttribute('src')).toContain('products/p-golden/golden.webp');
    expect(foregroundOf(active, 'Golden Watch').getAttribute('src')).toContain('products/p-golden/golden.webp');
    expect(active.textContent).toMatch(/Golden Watch/);
    expect(active.textContent).toMatch(/₹5,000\.00/);
    const cardCta = active.querySelector('a[aria-label="View Golden Watch"]');
    expect(cardCta).not.toBeNull();
    expect(cardCta.getAttribute('href')).toBe('/product/p-golden');
  });

  it('shows compare-at and discount only from real MRP data', async () => {
    const { container } = renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });

    // Yo Watch: genuine MRP 1200 > price 1000 → strikethrough + 17% badge.
    let active = activeSlide(container);
    expect(active.textContent).toMatch(/₹1,200\.00/);
    expect(active.textContent).toMatch(/17% off/);

    // Golden Watch: price 5000 above MRP 4500 → no strikethrough, no badge.
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    active = activeSlide(container);
    expect(active.textContent).toMatch(/₹5,000\.00/);
    expect(active.textContent).not.toMatch(/% off/);
    expect(active.textContent).not.toMatch(/₹4,500\.00/);
  });

  it('shows the real formatted price in the active slide', async () => {
    renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });
    // Yo Watch variant price 1000.00 rendered from real product data.
    expect(screen.getAllByText('₹1,000.00').length).toBeGreaterThanOrEqual(1);
  });

  it('places edge arrows and bottom dots inside the hero', async () => {
    const { container } = renderHero(<HeroCarousel products={[watchProduct(), goldenWatch()]} />);
    await screen.findByRole('heading', { name: 'Everyday time, done right.' });

    const dots = container.querySelector('[aria-label="Choose slide"]');
    expect(dots).not.toBeNull();
    // Both arrows are visible at every breakpoint (no `hidden` class —
    // a previous revision hid them below md and mobile lost the arrows).
    for (const label of ['Previous slide', 'Next slide']) {
      const arrow = screen.getByRole('button', { name: label });
      expect(arrow.className).toMatch(/absolute/);
      expect(arrow.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    }
  });
});
