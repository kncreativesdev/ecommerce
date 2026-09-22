import { useEffect, useMemo, useState } from 'react';
import { useProductStore } from '../stores/useProductStore.js';
import { searchProducts } from '../utils/productAdapter.js';

/**
 * Client-side search over the loaded catalog cache (no backend endpoint —
 * API_INTEGRATION §7 / GAP-04). Debounced input (≈250ms); deterministic
 * results in catalog order. Returns `{ query, setQuery, results,
 * searched }` where `searched` is true once a non-empty debounced query
 * has been evaluated.
 */
export function useCatalogSearch(initialQuery = '', delayMs = 250) {
  const products = useProductStore((state) => state.products);
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [prevInitial, setPrevInitial] = useState(initialQuery);

  // Render-time adjustment (sanctioned derived-state pattern): external
  // query changes (back/forward) reset both fields without an effect.
  if (prevInitial !== initialQuery) {
    setPrevInitial(initialQuery);
    setQuery(initialQuery);
    setDebounced(initialQuery);
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), delayMs);
    return () => clearTimeout(timer);
  }, [query, delayMs]);

  const results = useMemo(() => searchProducts(products, debounced), [products, debounced]);

  return {
    query,
    setQuery,
    debouncedQuery: debounced.trim(),
    results,
    searched: debounced.trim() !== '',
  };
}
