import { create } from 'zustand';
import { activateProduct, createProduct, fetchProducts, updateProduct } from '../services/product.service.js';

/**
 * Admin product state (Zustand) — backend-managed ONLY (no static data).
 * List mirror + create/update actions that apply server responses.
 * Product payloads are used as returned (admin reads need no
 * presentation normalization yet).
 *
 * The mirror holds the rows of the current `scope` (`active` by default;
 * `inactive`/`all` via the admin-safe `?status=` filter). Deactivation
 * drops the row only under the active scope; activation upserts so the row
 * stays visible everywhere.
 */
export const useProductStore = create((set, get) => ({
  products: [],
  status: 'idle',
  error: null,
  /** List scope: `active` (default) | `inactive` | `all` (admin `?status=`). */
  scope: 'active',

  ensureProducts: async () => {
    const { status } = get();
    if (status === 'success' || status === 'loading') return;
    await get().refreshProducts();
  },

  refreshProducts: async (scope = get().scope) => {
    set({ status: 'loading', error: null, scope });
    try {
      const payload = await fetchProducts(scope);
      set({
        products: Array.isArray(payload) ? payload : [],
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

  /** Switch the list scope (All/Active/Inactive) and reload the mirror. */
  setScope: (scope) => {
    if (scope === get().scope && get().status === 'success') return Promise.resolve();
    return get().refreshProducts(scope);
  },

  createProduct: async (payload) => {
    const record = await createProduct(payload);
    if (record?.id) {
      set((state) => ({ products: [...state.products, record] }));
    }
    return record;
  },

  updateProduct: async (id, payload) => {
    const record = await updateProduct(id, payload);
    if (record?.id) {
      set((state) => ({
        products: state.products.map((item) => (item.id === record.id ? record : item)),
      }));
    }
    return record;
  },

  getProductById: (id) => {
    if (!id) return undefined;
    return get().products.find((product) => product.id === id);
  },

  /** Mirror-sync a server-fresh record (e.g. after variant mutations). */
  syncProduct: (record) => {
    if (!record?.id) return;
    set((state) => ({
      products: state.products.some((item) => item.id === record.id)
        ? state.products.map((item) => (item.id === record.id ? record : item))
        : [...state.products, record],
    }));
  },

  /**
   * Drop a deactivated product from the mirror only when the current scope
   * would hide it (active scope); otherwise upsert the inactive record so
   * All/Inactive views keep showing the row.
   */
  removeProduct: (id, record = null) => {
    if (!id) return;
    set((state) => {
      if (state.scope !== 'active' && record?.id) {
        return {
          products: state.products.some((item) => item.id === record.id)
            ? state.products.map((item) => (item.id === record.id ? record : item))
            : [...state.products, record],
        };
      }
      return { products: state.products.filter((item) => item.id !== id) };
    });
  },

  /** Reactivate via documented `PATCH { isActive: true }`; row stays visible. */
  activateProduct: async (id) => {
    const record = await activateProduct(id);
    if (record?.id) get().syncProduct(record);
    return record;
  },

  clearError: () => set({ error: null }),
}));
