import { useEffect } from 'react';
import { useCategoryStore } from '../stores/useCategoryStore.js';

/**
 * Taxonomy hook: the header/layout data flow.
 *
 * ```
 * Header / layout layer
 *   ↓  useTaxonomy()
 * taxonomy store (normalized taxonomy)
 *   ↓  props
 * CategoryMegaMenu / MobileMenu / SearchPanel
 * ```
 *
 * Selects the normalized taxonomy + active category from the store and
 * triggers the one-time backend fetch on mount. Presentation components
 * receive data via props and never fetch, never import the fallback file,
 * and never touch the service layer.
 *
 * @returns {{ taxonomy, status, error, source, activeSlug, setActiveSlug, refreshTaxonomy }}
 */
export function useTaxonomy() {
  const taxonomy = useCategoryStore((state) => state.taxonomy);
  const status = useCategoryStore((state) => state.status);
  const error = useCategoryStore((state) => state.error);
  const source = useCategoryStore((state) => state.source);
  const activeSlug = useCategoryStore((state) => state.activeSlug);
  const setActiveSlug = useCategoryStore((state) => state.setActiveSlug);
  const refreshTaxonomy = useCategoryStore((state) => state.refreshTaxonomy);

  useEffect(() => {
    useCategoryStore.getState().ensureTaxonomy();
  }, []);

  return {
    taxonomy,
    status,
    error,
    source,
    activeSlug,
    setActiveSlug,
    refreshTaxonomy,
  };
}
