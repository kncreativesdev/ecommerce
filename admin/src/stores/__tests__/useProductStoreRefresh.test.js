import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductStore } from '../useProductStore.js';
import { fetchProducts } from '../../services/product.service.js';

vi.mock('../../services/product.service.js', () => ({
  fetchProducts: vi.fn(),
  fetchProductById: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deactivateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  activateProduct: vi.fn(),
}));

const VALID_SCOPES = ['active', 'inactive', 'all'];

function validCalls() {
  return fetchProducts.mock.calls.map((call) => call[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchProducts.mockResolvedValue([]);
  useProductStore.setState({ products: [], status: 'idle', error: null, scope: 'active' });
});

describe('useProductStore refresh scope boundary', () => {
  it('refreshes with the current scope by default', async () => {
    await useProductStore.getState().refreshProducts();
    expect(fetchProducts).toHaveBeenCalledWith('active');
    expect(useProductStore.getState().scope).toBe('active');
  });

  it('never forwards a click event (or any non-scope value) as the status', async () => {
    // Regression: the page once wired `onClick={refreshProducts}`, leaking
    // the React synthetic event into `scope` and producing
    // `?status=[object Object]` → 422 "Invalid status filter".
    const fakeClickEvent = { nativeEvent: {}, type: 'click', target: {}, currentTarget: {} };
    await useProductStore.getState().refreshProducts(fakeClickEvent);

    expect(fetchProducts).toHaveBeenCalledTimes(1);
    expect(validCalls()).toEqual(['active']);
    expect(useProductStore.getState().scope).toBe('active');
  });

  it('falls back to the current scope for unknown status strings', async () => {
    useProductStore.setState({ scope: 'inactive' });
    await useProductStore.getState().refreshProducts('bogus');

    expect(fetchProducts).toHaveBeenCalledTimes(1);
    expect(validCalls()).toEqual(['inactive']);
    expect(useProductStore.getState().scope).toBe('inactive');
  });

  it('accepts each backend-supported scope and keeps it after repeated refreshes', async () => {
    for (const scope of VALID_SCOPES) {
      await useProductStore.getState().refreshProducts(scope);
      await useProductStore.getState().refreshProducts();
      await useProductStore.getState().refreshProducts();
      expect(useProductStore.getState().scope).toBe(scope);
    }
    for (const status of validCalls()) {
      expect(VALID_SCOPES).toContain(status);
    }
  });

  it('setScope switches scope through the guarded refresh', async () => {
    await useProductStore.getState().setScope('all');
    expect(fetchProducts).toHaveBeenLastCalledWith('all');
    expect(useProductStore.getState().scope).toBe('all');
  });
});
