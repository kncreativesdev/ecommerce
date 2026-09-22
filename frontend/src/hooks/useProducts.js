import { useEffect } from 'react';
import { useProductStore } from '../stores/useProductStore.js';

/**
 * Catalog hook: the Shop/listing data flow.
 *
 * ```
 * Page
 *   ↓  useProducts()
 * product store (normalized full-catalog cache)
 *   ↓  props
 * ProductGrid / ProductCard
 * ```
 *
 * Selects the catalog cache + status from the store and triggers the
 * one-time backend fetch on mount. Pages derive category filtering and
 * sorting client-side from `products` (no backend query params exist —
 * GAP-04). Presentation components receive data via props and never fetch.
 *
 * @returns {{ products, status, error, isLoading, refreshProducts, ensureProduct, getProductById }}
 */
export function useProducts() {
  const products = useProductStore((state) => state.products);
  const status = useProductStore((state) => state.status);
  const error = useProductStore((state) => state.error);
  const refreshProducts = useProductStore((state) => state.refreshProducts);
  const ensureProduct = useProductStore((state) => state.ensureProduct);
  const getProductById = useProductStore((state) => state.getProductById);

  useEffect(() => {
    useProductStore.getState().ensureProducts();
  }, []);

  return {
    products,
    status,
    error,
    isLoading: status === 'idle' || status === 'loading',
    refreshProducts,
    ensureProduct,
    getProductById,
  };
}
