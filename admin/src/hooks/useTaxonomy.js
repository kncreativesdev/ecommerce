import { useEffect } from 'react';
import { useCategoryStore } from '../stores/useCategoryStore.js';

/**
 * Admin taxonomy hook: pages select the backend-managed category list and
 * trigger the one-time fetch on mount. No fallback data, no fetching in
 * presentation components.
 *
 * @returns {{ categories, status, error, isLoading, scope, setScope, refreshCategories }}
 */
export function useTaxonomy() {
  const categories = useCategoryStore((state) => state.categories);
  const status = useCategoryStore((state) => state.status);
  const error = useCategoryStore((state) => state.error);
  const scope = useCategoryStore((state) => state.scope);
  const setScope = useCategoryStore((state) => state.setScope);
  const refreshCategories = useCategoryStore((state) => state.refreshCategories);

  useEffect(() => {
    useCategoryStore.getState().ensureCategories();
  }, []);

  return {
    categories,
    status,
    error,
    isLoading: status === 'idle' || status === 'loading',
    scope,
    setScope,
    refreshCategories,
  };
}
