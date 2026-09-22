import { describe, expect, it } from 'vitest';
import { getDefaultVariantImage } from '../variantMedia.js';

const PRODUCT = {
  id: 'p',
  variants: [
    { id: 'v-a', name: 'Black', isActive: true },
    { id: 'v-b', name: 'Blue', isActive: true },
  ],
};

const IMAGES = [
  { id: 'p-hero', variantId: null, sortOrder: 5, isPrimary: false, storagePath: 'products/p/hero.webp' },
  { id: 'p-main', variantId: null, sortOrder: 1, isPrimary: true, storagePath: 'products/p/main.webp' },
  { id: 'a-2', variantId: 'v-a', sortOrder: 1, isPrimary: false, storagePath: 'products/p/a2.webp' },
  { id: 'a-1', variantId: 'v-a', sortOrder: 0, isPrimary: true, storagePath: 'products/p/a1.webp' },
  { id: 'b-1', variantId: 'v-b', sortOrder: 0, isPrimary: false, storagePath: 'products/p/b1.webp' },
];

describe('getDefaultVariantImage (product-card rule)', () => {
  it('uses the default (first active) variant primary image', () => {
    expect(getDefaultVariantImage(IMAGES, PRODUCT).id).toBe('a-1');
  });

  it('uses the default variant first ordered image when no primary exists', () => {
    const product = { variants: [{ id: 'v-b', isActive: true }] };
    expect(getDefaultVariantImage(IMAGES, product).id).toBe('b-1');
  });

  it('falls back to the legacy product-level primary image when the default variant has no images', () => {
    const product = { variants: [{ id: 'v-unknown', isActive: true }] };
    expect(getDefaultVariantImage(IMAGES, product).id).toBe('p-main');
  });

  it('falls back to the product-level first image when no primary exists anywhere', () => {
    const images = [
      { id: 'p-2', variantId: null, sortOrder: 3, isPrimary: false },
      { id: 'p-1', variantId: null, sortOrder: 1, isPrimary: false },
    ];
    const product = { variants: [{ id: 'v-unknown', isActive: true }] };
    expect(getDefaultVariantImage(images, product).id).toBe('p-1');
  });

  it('never shows another variant images for the default variant', () => {
    const picked = getDefaultVariantImage(IMAGES, PRODUCT);
    expect(picked.variantId).toBe('v-a');
  });

  it('skips inactive variants when choosing the default', () => {
    const product = {
      variants: [
        { id: 'v-a', isActive: false },
        { id: 'v-b', isActive: true },
      ],
    };
    expect(getDefaultVariantImage(IMAGES, product).id).toBe('b-1');
  });

  it('returns null when no images exist at all (placeholder contract)', () => {
    expect(getDefaultVariantImage([], PRODUCT)).toBeNull();
    expect(getDefaultVariantImage([], { variants: [] })).toBeNull();
  });

  it('is deterministic across repeated calls', () => {
    const first = getDefaultVariantImage(IMAGES, PRODUCT);
    const second = getDefaultVariantImage([...IMAGES].reverse(), PRODUCT);
    expect(second.id).toBe(first.id);
  });
});
