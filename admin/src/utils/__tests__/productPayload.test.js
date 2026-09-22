import { describe, expect, it } from 'vitest';
import { buildCreateProductPayload } from '../productPayload.js';

const FIELDS = { name: 'Test Speaker', slug: '', brand: '', shortDescription: '', description: '', isActive: true, isFeatured: false };

describe('buildCreateProductPayload variants', () => {
  it('maps multiple variant rows to the backend variants array', () => {
    const payload = buildCreateProductPayload({
      parentCategoryId: 'cat1',
      subcategoryId: '',
      fields: FIELDS,
      variants: [
        { sku: 'A-1', name: 'Black', price: '100.00', compareAtPrice: '', barcode: '', weight: '' },
        { sku: 'A-2', name: 'Blue', price: '120.00', compareAtPrice: '150.00', barcode: 'BC1', weight: '0.5' },
      ],
    });
    expect(payload.variants).toEqual([
      { sku: 'A-1', name: 'Black', price: '100.00', compareAtPrice: null, barcode: null, weight: null },
      { sku: 'A-2', name: 'Blue', price: '120.00', compareAtPrice: '150.00', barcode: 'BC1', weight: '0.5' },
    ]);
  });

  it('omits the variants key for an empty list (product shell)', () => {
    const payload = buildCreateProductPayload({ parentCategoryId: 'cat1', subcategoryId: '', fields: FIELDS, variants: [] });
    expect(payload).not.toHaveProperty('variants');
    expect(payload.categoryId).toBe('cat1');
  });

  it('drops incomplete rows instead of sending invalid variants', () => {
    const payload = buildCreateProductPayload({
      parentCategoryId: 'cat1',
      subcategoryId: '',
      fields: FIELDS,
      variants: [{ sku: '', name: 'No SKU', price: '10.00', compareAtPrice: '', barcode: '', weight: '' }],
    });
    expect(payload).not.toHaveProperty('variants');
  });
});
