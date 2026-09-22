import { describe, expect, it } from 'vitest';
import { resolveCategoryImageUrl } from '../media.service.js';
import {
  adaptBackendCategory,
  buildTaxonomy,
} from '../../utils/categoryAdapter.js';

const BASE = 'http://localhost:3000';

describe('resolveCategoryImageUrl', () => {
  it('joins a managed storage reference with the media base', () => {
    expect(resolveCategoryImageUrl('categories/cat-1/abc.webp', BASE)).toBe(
      `${BASE}/categories/cat-1/abc.webp`,
    );
  });

  it('tolerates leading/trailing slashes', () => {
    expect(resolveCategoryImageUrl('/categories/cat-1/abc.webp', `${BASE}/`)).toBe(
      `${BASE}/categories/cat-1/abc.webp`,
    );
  });

  it('returns null for missing, blank, or non-string references', () => {
    expect(resolveCategoryImageUrl(null, BASE)).toBeNull();
    expect(resolveCategoryImageUrl(undefined, BASE)).toBeNull();
    expect(resolveCategoryImageUrl('', BASE)).toBeNull();
    expect(resolveCategoryImageUrl('   ', BASE)).toBeNull();
    expect(resolveCategoryImageUrl(42, BASE)).toBeNull();
  });

  it('returns null without a media base', () => {
    expect(resolveCategoryImageUrl('categories/cat-1/abc.webp', '')).toBeNull();
    expect(resolveCategoryImageUrl('categories/cat-1/abc.webp', null)).toBeNull();
  });
});

describe('taxonomy adapter image retention', () => {
  it('keeps the category image from the backend record', () => {
    const normalized = adaptBackendCategory({
      id: 'cat-1',
      slug: 'audio',
      name: 'Audio',
      description: '',
      image: 'categories/cat-1/abc.webp',
      parentId: null,
      sortOrder: 0,
    });
    expect(normalized.image).toBe('categories/cat-1/abc.webp');
  });

  it('keeps subcategory images through buildTaxonomy', () => {
    const taxonomy = buildTaxonomy(
      [
        { id: 'cat-1', slug: 'audio', name: 'Audio', parentId: null, sortOrder: 0, image: 'categories/cat-1/hero.webp' },
        { id: 'sub-1', slug: 'earbuds', name: 'Earbuds', parentId: 'cat-1', sortOrder: 0, image: 'categories/sub-1/thumb.webp' },
        { id: 'sub-2', slug: 'speakers', name: 'Speakers', parentId: 'cat-1', sortOrder: 1, image: null },
      ],
      { fallback: [] },
    );
    expect(taxonomy).toHaveLength(1);
    expect(taxonomy[0].image).toBe('categories/cat-1/hero.webp');
    expect(taxonomy[0].subcategorySource).toBe('api');
    expect(taxonomy[0].subcategories[0].image).toBe('categories/sub-1/thumb.webp');
    expect(taxonomy[0].subcategories[1].image).toBeNull();
  });

  it('defaults missing images to null (fallback icon contract)', () => {
    expect(adaptBackendCategory({ id: 'c', slug: 's', name: 'N' }).image).toBeNull();
  });
});
