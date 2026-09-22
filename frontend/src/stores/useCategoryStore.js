import { create } from 'zustand';
import { fetchCategories } from '../services/category.service.js';
import { buildTaxonomy, normalizeFallbackTaxonomy } from '../utils/categoryAdapter.js';
import { categoryNavItems } from '../data/categories.js';

/**
 * Backend-driven taxonomy state (Zustand).
 *
 * Server-state mirror per FRONTEND_ARCHITECTURE.md §6:
 * `{ taxonomy, status: idle|loading|success|error, error }` + actions.
 * The store calls the service; the service owns fetch construction;
 * components consume this store and never fetch.
 *
 * Data policy (TASK 10):
 * - Initial state serves the normalized FALLBACK taxonomy synchronously,
 *   so the header renders instantly with zero layout shift and no skeleton
 *   flash. `status` starts at `idle`, `source` at `'fallback'`.
 * - `ensureTaxonomy()` fetches `GET /categories` once (single-flight).
 *   Success with a usable non-empty list → backend-derived taxonomy
 *   (`source: 'api'`), top-level from the API, subcategories from API
 *   `parentId` children where present, documented fallback subcategories
 *   elsewhere (`subcategorySource` per category — honest, never presented
 *   as backend-backed).
 * - Failure OR empty/unusable response → keep serving the fallback
 *   taxonomy (`status: 'error'`, `error` recorded, header never crashes).
 *
 * `activeSlug` is the mega-menu's selected category, owned here so Header,
 * CategoryMegaMenu, and future Shop filters share one source of truth.
 */
const fallbackTaxonomy = normalizeFallbackTaxonomy(categoryNavItems);

let inflight = null;

export const useCategoryStore = create((set, get) => ({
  /** Normalized taxonomy (fallback until the backend succeeds). */
  taxonomy: fallbackTaxonomy,
  status: 'idle',
  error: null,
  /** 'fallback' until a backend payload is adopted, then 'api'. */
  source: 'fallback',
  /** Selected category slug (mega-menu active state, future filters). */
  activeSlug: fallbackTaxonomy[0]?.slug ?? null,

  setActiveSlug: (slug) => {
    if (typeof slug === 'string' && slug !== '') {
      set({ activeSlug: slug });
    }
  },

  /** Fetch-once: concurrent callers share the same request. */
  ensureTaxonomy: () => {
    const { status } = get();
    if (status === 'loading' && inflight) return inflight;
    if (status === 'success') return Promise.resolve();
    inflight = get().refreshTaxonomy().finally(() => {
      inflight = null;
    });
    return inflight;
  },

  /** Force re-fetch (future admin-then-refresh flows reuse this). */
  refreshTaxonomy: async () => {
    set({ status: 'loading', error: null });
    try {
      const payload = await fetchCategories();
      if (!Array.isArray(payload) || payload.length === 0) {
        throw new Error('Category API returned an empty or unusable list.');
      }
      const taxonomy = buildTaxonomy(payload, { fallback: categoryNavItems });
      if (taxonomy.length === 0) {
        throw new Error('Category API returned no top-level categories.');
      }
      set((state) => ({
        taxonomy,
        status: 'success',
        error: null,
        source: 'api',
        activeSlug: taxonomy.some((category) => category.slug === state.activeSlug)
          ? state.activeSlug
          : (taxonomy[0]?.slug ?? null),
      }));
    } catch (error) {
      // Graceful fallback: keep serving the static taxonomy; record why.
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load categories.' },
      });
    }
  },
}));
