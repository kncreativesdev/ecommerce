import { describe, expect, it } from 'vitest';
import {
  displayImageForVariant,
  galleryForVariant,
  primaryImageFor,
  productLevelImages,
  variantImages,
} from '../variantMedia.js';

const IMAGES = [
  { id: 'p-hero', variantId: null, sortOrder: 5, isPrimary: false, storagePath: 'products/p/hero.webp' },
  { id: 'p-main', variantId: null, sortOrder: 1, isPrimary: true, storagePath: 'products/p/main.webp' },
  { id: 'a-2', variantId: 'v-a', sortOrder: 1, isPrimary: false, storagePath: 'products/p/a2.webp' },
  { id: 'a-1', variantId: 'v-a', sortOrder: 0, isPrimary: true, storagePath: 'products/p/a1.webp' },
  { id: 'b-1', variantId: 'v-b', sortOrder: 0, isPrimary: false, storagePath: 'products/p/b1.webp' },
];

describe('variantMedia selectors', () => {
  it('partitions variant galleries without mixing variants', () => {
    expect(variantImages(IMAGES, 'v-a').map((image) => image.id)).toEqual(['a-1', 'a-2']);
    expect(variantImages(IMAGES, 'v-b').map((image) => image.id)).toEqual(['b-1']);
    expect(variantImages(IMAGES, 'v-unknown')).toEqual([]);
  });

  it('falls back to product-level images when the variant has none', () => {
    expect(galleryForVariant(IMAGES, 'v-unknown').map((image) => image.id)).toEqual(['p-main', 'p-hero']);
    expect(galleryForVariant(IMAGES, 'v-a').map((image) => image.id)).toEqual(['a-1', 'a-2']);
    expect(galleryForVariant([], 'v-a')).toEqual([]);
  });

  it('collects only product-level images', () => {
    expect(productLevelImages(IMAGES).map((image) => image.id)).toEqual(['p-main', 'p-hero']);
  });

  it('prefers primary, else first in sort order', () => {
    expect(primaryImageFor(variantImages(IMAGES, 'v-a')).id).toBe('a-1');
    expect(primaryImageFor(variantImages(IMAGES, 'v-b')).id).toBe('b-1');
    expect(primaryImageFor([])).toBeNull();
  });

  it('resolves the display image per variant with fallback', () => {
    expect(displayImageForVariant(IMAGES, 'v-a').id).toBe('a-1');
    expect(displayImageForVariant(IMAGES, 'v-b').id).toBe('b-1');
    expect(displayImageForVariant(IMAGES, 'v-unknown').id).toBe('p-main');
    expect(displayImageForVariant(IMAGES, null).id).toBe('p-main');
  });
});
