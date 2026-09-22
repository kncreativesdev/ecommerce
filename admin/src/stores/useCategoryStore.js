import { create } from 'zustand';
import {
  activateCategory,
  createCategory,
  deactivateCategory,
  fetchCategories,
  updateCategory,
} from '../services/category.service.js';
import { adaptCategory, adaptCategoryList } from '../utils/taxonomy.js';

/**
 * Admin taxonomy state (Zustand) — backend-managed ONLY.
 *
 * Critical boundary (unlike the storefront): NO static fallback taxonomy
 * exists here. An admin must never view or edit fabricated categories, so:
 * - initial `categories` is `[]` (not fallback data),
 * - failure keeps `[]` and records `error` (page shows error + retry),
 * - an empty backend list is a valid empty state (genuine "no categories").
 *
 * The mirror holds the rows of the current `scope` (`active` by default;
 * `inactive`/`all` via the admin-safe `?status=` filter). Mutations apply
 * the server response to the mirror: deactivation upserts the returned
 * (now inactive) record and drops it only when the active scope would hide
 * it; activation upserts so the row stays visible under every scope.
 */
let listInflight = null;

function upsert(categories, record) {
  if (!record?.id) return categories;
  const exists = categories.some((category) => category.id === record.id);
  if (!exists) return [...categories, record];
  return categories.map((category) => (category.id === record.id ? record : category));
}

/** Apply a deactivation result to a scoped mirror (see action below). */
function applyDeactivated(categories, scope, adapted) {
  if (scope === 'active') {
    return categories.filter((category) => category.id !== adapted?.id);
  }
  if (adapted) return upsert(categories, adapted);
  return categories;
}

export const useCategoryStore = create((set, get) => ({
  categories: [],
  status: 'idle',
  error: null,
  /** List scope: `active` (default) | `inactive` | `all` (admin `?status=`). */
  scope: 'active',

  ensureCategories: () => {
    const { status } = get();
    if (status === 'loading' && listInflight) return listInflight;
    if (status === 'success') return Promise.resolve();
    if (status === 'loading') return Promise.resolve();
    listInflight = get().refreshCategories().finally(() => {
      listInflight = null;
    });
    return listInflight;
  },

  refreshCategories: async (scope = get().scope) => {
    set({ status: 'loading', error: null, scope });
    try {
      const payload = await fetchCategories(scope);
      set({
        categories: adaptCategoryList(payload),
        status: 'success',
        error: null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: { message: error?.message ?? 'Failed to load categories.', code: error?.code },
      });
    }
  },

  /** Switch the list scope (All/Active/Inactive) and reload the mirror. */
  setScope: (scope) => {
    if (scope === get().scope && get().status === 'success') return Promise.resolve();
    return get().refreshCategories(scope);
  },

  createCategory: async (payload) => {
    const record = await createCategory(payload);
    if (record?.id) {
      set((state) => ({ categories: upsert(state.categories, adaptCategory(record)) }));
    }
    return record;
  },

  updateCategory: async (id, payload) => {
    const record = await updateCategory(id, payload);
    if (record?.id) {
      set((state) => ({ categories: upsert(state.categories, adaptCategory(record)) }));
    }
    return record;
  },

  /**
   * Documented semantics: soft-deactivate. The returned (inactive) record
   * is upserted; it leaves the mirror only when the current scope would
   * hide it (active scope), so All/Inactive views keep showing the row.
   */
  deactivateCategory: async (id) => {
    const record = await deactivateCategory(id);
    const adapted = record?.id ? adaptCategory(record) : null;
    set((state) => ({ categories: applyDeactivated(state.categories, state.scope, adapted) }));
    return record;
  },

  /** Reactivate via documented `PATCH { isActive: true }`; row stays visible. */
  activateCategory: async (id) => {
    const record = await activateCategory(id);
    if (record?.id) {
      set((state) => ({ categories: upsert(state.categories, adaptCategory(record)) }));
    }
    return record;
  },

  clearError: () => set({ error: null }),
}));
