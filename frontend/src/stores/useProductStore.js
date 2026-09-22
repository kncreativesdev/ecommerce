import { create } from 'zustand';
import { fetchProductById, fetchProducts } from '../services/product.service.js';
import { adaptProduct, adaptProductList } from '../utils/productAdapter.js';

/**
 * Product/catalog state (Zustand).
 *
 * Server-state mirror per FRONTEND_ARCHITECTURE.md §6:
 * `{ products, status: idle|loading|success|error, error }` + actions.
 * The store calls the service; the service owns fetch construction;
 * components consume this store and never fetch.
 *
 * Data policy (backend exposes only `GET /products` + `GET /products/:id`,
 * no query params — GAP-04):
 * - `ensureProducts()` loads the FULL active catalog once per session
 *   (single-flight). All Shop filtering/sorting derives client-side from
 *   this cache; no per-keystroke fetching.
 * - `ensureProduct(id)` serves deep links: cache hit returns immediately,
 *   otherwise a single `GET /products/:id` is merged into the cache
 *   (deduped by id). `404 PRODUCT_NOT_FOUND` surfaces as `error` with
 *   `code: 'NOT_FOUND'` so detail pages render a not-found state.
 * - Failure keeps previously loaded products (if any) and records the
 *   error — pages render retry states, never crashes.
 */
let listInflight = null;
const detailInflight = new Map();

export const useProductStore = create((set, get) => ({
  /** Normalized full-catalog cache (`GET /products`). */
  products: [],
  status: 'idle',
  error: null,

  /** Load the full catalog once; concurrent callers share the request. */
  ensureProducts: () => {
    const { status } = get();
    if (status === 'loading' && listInflight) return listInflight;
    // 'success' is terminal (an empty catalog is valid); 'error' retries.
    if (status === 'success' || status === 'loading') return Promise.resolve();
    listInflight = get().refreshProducts().finally(() => {
      listInflight = null;
    });
    return listInflight;
  },

  /** Force re-fetch of the full catalog. */
  refreshProducts: async () => {
    set({ status: 'loading', error: null });
    try {
      const payload = await fetchProducts();
      set({
        products: adaptProductList(payload),
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load products.', code: error?.code },
      });
    }
  },

  /**
   * Ensure one product is available (detail deep-links). Cache-first;
   * fetches `GET /products/:id` only on miss. Merges into the cache.
   */
  ensureProduct: (id) => {
    if (!id) return Promise.resolve(null);
    const cached = get().products.find((product) => product.id === id);
    if (cached) return Promise.resolve(cached);
    if (detailInflight.has(id)) return detailInflight.get(id);
    const request = (async () => {
      try {
        const record = await fetchProductById(id);
        const product = adaptProduct(record);
        if (!product) {
          set({
            error: { message: 'Product not found.', code: 'NOT_FOUND' },
          });
          return null;
        }
        set((state) => ({
          // Replace any stale row with the fresh detail payload.
          products: [...state.products.filter((item) => item.id !== product.id), product],
          error: null,
        }));
        return product;
      } catch (error) {
        const code = error?.status === 404 || error?.code === 'PRODUCT_NOT_FOUND' ? 'NOT_FOUND' : error?.code;
        set({
          error: { message: error?.message ?? 'Failed to load the product.', code },
        });
        return null;
      } finally {
        detailInflight.delete(id);
      }
    })();
    detailInflight.set(id, request);
    return request;
  },

  /** Selector helper: read one product from the cache (or `undefined`). */
  getProductById: (id) => {
    if (!id) return undefined;
    return get().products.find((product) => product.id === id);
  },

  clearError: () => set({ error: null }),
}));
