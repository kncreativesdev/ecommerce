import { describe, expect, it } from 'vitest';
import {
  galleryForVariant,
  getDefaultVariantImage,
  getProductCardImage,
  productPrimaryImage,
} from '../variantMedia.js';

const PRODUCT = {
  id: 'p',
  variants: [
    { id: 'v-a', name: 'Black', isActive: true },
    { id: 'v-b', name: 'Blue', isActive: true },
  ],
};

describe('productPrimaryImage (single product-level primary)', () => {
  it('finds the explicit primary regardless of owning variant', () => {
    const images = [
      { id: 'a-1', variantId: 'v-a', sortOrder: 0, isPrimary: false },
      { id: 'b-1', variantId: 'v-b', sortOrder: 0, isPrimary: true },
    ];
    expect(productPrimaryImage(images).id).toBe('b-1');
  });

  it('returns null when no explicit primary exists (fallback contract)', () => {
    const images = [
      { id: 'a-1', variantId: 'v-a', sortOrder: 0, isPrimary: false },
      { id: 'p-1', variantId: null, sortOrder: 0, isPrimary: false },
    ];
    expect(productPrimaryImage(images)).toBeNull();
    expect(productPrimaryImage([])).toBeNull();
  });

  it('wins ties by lowest sortOrder', () => {
    const images = [
      { id: 'late', variantId: 'v-a', sortOrder: 5, isPrimary: true },
      { id: 'early', variantId: null, sortOrder: 1, isPrimary: true },
    ];
    expect(productPrimaryImage(images).id).toBe('early');
  });
});

describe('getProductCardImage (card rule)', () => {
  it('selects the explicitly primary image', () => {
    const images = [
      { id: 'a-1', variantId: 'v-a', sortOrder: 0, isPrimary: false },
      { id: 'a-2', variantId: 'v-a', sortOrder: 1, isPrimary: false },
      { id: 'p-main', variantId: null, sortOrder: 0, isPrimary: true },
    ];
    expect(getProductCardImage(images, PRODUCT).id).toBe('p-main');
  });

  it('uses a primary belonging to another (non-default) variant for the card', () => {
    const images = [
      { id: 'a-1', variantId: 'v-a', sortOrder: 0, isPrimary: false },
      { id: 'a-2', variantId: 'v-a', sortOrder: 1, isPrimary: false },
      { id: 'b-1', variantId: 'v-b', sortOrder: 0, isPrimary: true },
    ];
    const picked = getProductCardImage(images, PRODUCT);
    expect(picked.id).toBe('b-1');
    // The default-variant-only rule would have picked a-1 — the card
    // intentionally diverges here to honor the product-level primary.
    expect(getDefaultVariantImage(images, PRODUCT).id).toBe('a-1');
  });

  it('falls back to the default-variant image when no primary exists', () => {
    const images = [
      { id: 'a-1', variantId: 'v-a', sortOrder: 0, isPrimary: false },
      { id: 'b-1', variantId: 'v-b', sortOrder: 0, isPrimary: false },
      { id: 'p-1', variantId: null, sortOrder: 0, isPrimary: false },
    ];
    expect(getProductCardImage(images, PRODUCT).id).toBe('a-1');
  });

  it('falls back to legacy product-level media for imageless defaults', () => {
    const images = [{ id: 'p-1', variantId: null, sortOrder: 0, isPrimary: false }];
    const product = { variants: [{ id: 'v-unknown', isActive: true }] };
    expect(getProductCardImage(images, product).id).toBe('p-1');
  });

  it('returns null when no images exist (placeholder contract)', () => {
    expect(getProductCardImage([], PRODUCT)).toBeNull();
  });

  it('is deterministic across input order', () => {
    const images = [
      { id: 'b-1', variantId: 'v-b', sortOrder: 0, isPrimary: true },
      { id: 'a-1', variantId: 'v-a', sortOrder: 0, isPrimary: false },
    ];
    const reversed = [...images].reverse();
    expect(getProductCardImage(images, PRODUCT).id).toBe('b-1');
    expect(getProductCardImage(reversed, PRODUCT).id).toBe('b-1');
  });

  it('does not leak sibling images into the variant PDP gallery', () => {
    const images = [
      { id: 'a-1', variantId: 'v-a', sortOrder: 0, isPrimary: false },
      { id: 'b-1', variantId: 'v-b', sortOrder: 0, isPrimary: true },
      { id: 'p-1', variantId: null, sortOrder: 0, isPrimary: false },
    ];
    // Card shows the other variant's primary…
    expect(getProductCardImage(images, PRODUCT).id).toBe('b-1');
    // …but the v-a gallery contains only v-a images.
    expect(galleryForVariant(images, 'v-a').map((image) => image.id)).toEqual(['a-1']);
    expect(galleryForVariant(images, 'v-b').map((image) => image.id)).toEqual(['b-1']);
  });
});
