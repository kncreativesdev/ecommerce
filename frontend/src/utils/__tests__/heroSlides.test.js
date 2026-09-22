import { describe, expect, it } from 'vitest';
import { HERO_MAX_SLIDES, isWatchProduct, selectHeroWatchProducts } from '../heroSlides.js';

function productFixture(overrides = {}) {
  return {
    id: 'p-1',
    name: 'Yo Watch',
    slug: 'yo-watch',
    brand: 'King',
    isActive: true,
    variants: [{ id: 'v-1', sku: 'SKU-1', name: 'silver', price: '1000.00', isActive: true }],
    ...overrides,
  };
}

describe('heroSlides watch selection', () => {
  it('caps hero candidates at three in catalog order', () => {
    expect(HERO_MAX_SLIDES).toBe(3);
    const products = ['A Watch', 'B Watch', 'C Watch', 'D Watch'].map((name, index) =>
      productFixture({ id: `p-${index}`, name, slug: `slug-${index}` }),
    );
    expect(selectHeroWatchProducts(products).map((product) => product.id)).toEqual(['p-0', 'p-1', 'p-2']);
  });

  it('matches watch names case-insensitively and skips non-watches', () => {
    const products = [
      productFixture({ id: 'p-yo', name: 'Yo Watch' }),
      productFixture({ id: 'p-cable', name: 'SyncLine USB-C Cable' }),
      productFixture({ id: 'p-golden', name: 'GOLDEN watch' }),
    ];
    expect(selectHeroWatchProducts(products).map((product) => product.id)).toEqual(['p-yo', 'p-golden']);
  });

  it('skips inactive products and products without an active variant', () => {
    expect(isWatchProduct(productFixture({ isActive: false }))).toBe(false);
    expect(isWatchProduct(productFixture({ variants: [] }))).toBe(false);
    expect(
      isWatchProduct(productFixture({ variants: [{ id: 'v-x', isActive: false }] })),
    ).toBe(false);
    expect(isWatchProduct(productFixture())).toBe(true);
  });

  it('never invents slides from an empty or watch-free catalog', () => {
    expect(selectHeroWatchProducts([])).toEqual([]);
    expect(selectHeroWatchProducts([productFixture({ name: 'AirBeat Pro' })])).toEqual([]);
    expect(selectHeroWatchProducts(null)).toEqual([]);
  });
});
