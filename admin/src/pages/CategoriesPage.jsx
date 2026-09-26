import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Power, RotateCcw, Search, Tags, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTaxonomy } from '../hooks/useTaxonomy.js';
import { useCategoryStore } from '../stores/useCategoryStore.js';
import { deleteCategoryImage, uploadCategoryImage } from '../services/category.service.js';
import { buildCategoryTree } from '../utils/taxonomy.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { CategoryForm } from '../components/catalog/CategoryForm.jsx';
import { CategoryThumb } from '../components/catalog/CategoryThumb.jsx';
import { cn } from '../lib/cn.js';

/**
 * Category Management (`/catalog/categories`): ONE coherent tree of parent
 * categories + subcategories derived from backend `parentId`. All rows are
 * real backend data — the admin has no fallback taxonomy (an admin must
 * never edit fabricated categories).
 *
 * - Status filter (All/Active/Inactive) via the admin-safe `?status=`
 *   filter — deactivated rows stay discoverable and reactivatable.
 * - Client-side name/slug search over the scoped mirror.
 * - Create / edit via `CategoryForm` modal (strict documented payloads).
 * - Deactivate via confirm modal → documented soft-deactivate (`DELETE`).
 * - Reactivate via documented `PATCH { isActive: true }` (no confirm —
 *   non-destructive, immediately visible under every scope).
 * - Loading skeletons, scoped empty states, error + retry.
 */
const SCOPES = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export function CategoriesPage() {
  const { categories, isLoading, error, scope, setScope, refreshCategories } = useTaxonomy();
  const createCategory = useCategoryStore((state) => state.createCategory);
  const updateCategory = useCategoryStore((state) => state.updateCategory);
  const deactivateCategory = useCategoryStore((state) => state.deactivateCategory);
  const activateCategory = useCategoryStore((state) => state.activateCategory);

  const [formState, setFormState] = useState(null); // { mode: 'create' } | { mode: 'edit', category }
  const [deactivating, setDeactivating] = useState(null); // category
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [activatingId, setActivatingId] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    document.title = 'Categories — Tech Pulse Admin';
  }, []);

  // Client-side name/slug search over the scoped mirror (the backend
  // exposes no search param — the scoped list is already small).
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return categories;
    return categories.filter((category) =>
      [category?.name, category?.slug].some(
        (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
      ),
    );
  }, [categories, query]);

  const tree = useMemo(() => buildCategoryTree(filtered), [filtered]);
  const totalSubcategories = filtered.filter((category) => category.parentId).length;
  const deactivatingChildCount = deactivating
    ? categories.filter((category) => category.parentId === deactivating.id).length
    : 0;

  const closeForm = () => {
    if (!saving) setFormState(null);
  };

  const handleFormSubmit = async (payload, imageAction = null) => {
    setSaving(true);
    try {
      let id = formState?.mode === 'edit' ? formState.category.id : null;
      const isEdit = formState?.mode === 'edit';
      if (isEdit) {
        await updateCategory(id, payload);
      } else {
        const record = await createCategory(payload);
        id = record?.id ?? null;
      }
      // Image step runs after the record exists (create has no id before).
      // Record toasts are deliberately deferred until here so a failed
      // image step reports partial success truthfully instead of claiming
      // everything worked.
      try {
        if (id && imageAction?.file) {
          await uploadCategoryImage(id, imageAction.file);
        } else if (id && imageAction?.remove && imageAction?.hadManagedImage) {
          await deleteCategoryImage(id);
        }
      } catch (imageError) {
        toast.error(
          imageAction?.file
            ? isEdit
              ? `“${payload.name}” saved, but the image upload failed — the previous image is unchanged.`
              : `“${payload.name}” created, but the image upload failed — add it again from Edit.`
            : `“${payload.name}” saved, but the old image file could not be removed.`,
        );
        throw imageError;
      }
      toast.success(
        isEdit
          ? `“${payload.name}” saved${imageAction?.file ? ' with a new image' : ''}.`
          : `“${payload.name}” created${payload.parentId ? ' as a subcategory' : ''}${imageAction?.file ? ' with an image' : ''}.`,
      );
      setSaving(false);
      setFormState(null);
      // Mirror already updated from the server response; refresh for truth.
      refreshCategories();
    } catch (error) {
      setSaving(false);
      // Field-mapped inside CategoryForm (including image upload failures);
      // surface only unmapped failures.
      const code = error?.code ?? '';
      if (!error?.details?.length && code !== 'CATEGORY_SLUG_EXISTS' && code !== 'CATEGORY_PARENT_NOT_FOUND' && code !== 'CATEGORY_SELF_PARENT' && code !== 'CATEGORY_CYCLE' && code !== 'CATEGORY_UPDATE_INVALID' && !code.startsWith('MEDIA_')) {
        toast.error(error?.message ?? 'Save failed. Please try again.');
      }
      throw error;
    }
  };

  const handleActivate = async (category) => {
    if (!category?.id || activatingId) return;
    setActivatingId(category.id);
    try {
      await activateCategory(category.id);
      toast.success(`“${category.name}” reactivated — visible in the storefront.`);
    } catch (error) {
      toast.error(error?.message ?? 'Reactivation failed. Please try again.');
    } finally {
      setActivatingId(null);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivating) return;
    setConfirmingDelete(true);
    try {
      await deactivateCategory(deactivating.id);
      toast.success(`“${deactivating.name}” deactivated — hidden from the storefront.`);
      setDeactivating(null);
    } catch (error) {
      toast.error(error?.message ?? 'Deactivation failed. Please try again.');
    } finally {
      setConfirmingDelete(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Category Management</h2>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {isLoading
              ? 'Loading categories…'
              : `${tree.length} parent ${tree.length === 1 ? 'category' : 'categories'} · ${totalSubcategories} ${totalSubcategories === 1 ? 'subcategory' : 'subcategories'}`}
          </p>
        </div>
        <Button onClick={() => setFormState({ mode: 'create' })}>
          <Plus size={17} aria-hidden="true" />
          Add Category
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div role="group" aria-label="Category status filter" className="inline-flex rounded-lg border border-border bg-surface p-1">
          {SCOPES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setScope(option.value)}
              aria-pressed={scope === option.value}
              disabled={isLoading}
              className={cn(
                'inline-flex min-h-[36px] cursor-pointer items-center rounded-md px-3.5 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60',
                scope === option.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div role="search" className="relative w-full sm:max-w-xs">
          <label htmlFor="category-search" className="sr-only">
            Search categories
          </label>
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="category-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name or slug…"
            autoComplete="off"
            className="min-h-[44px] w-full rounded-lg border border-input bg-surface pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div role="status" aria-label="Loading categories" className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} aria-hidden="true" className="h-14 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          title="Couldn’t load categories"
          message={error.message}
          onRetry={() => refreshCategories()}
        />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={Tags}
          title={
            scope === 'inactive'
              ? 'No inactive categories'
              : scope === 'all'
                ? 'No categories yet'
                : 'No categories yet'
          }
          message={
            scope === 'inactive'
              ? 'Every category is currently active. Deactivated categories will appear here for review and reactivation.'
              : 'Create the first parent category. Subcategories are created by choosing a parent in the same form.'
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No categories match"
          message={`Nothing matches “${query.trim()}” under the ${scope} filter. Try a different keyword or clear the search.`}
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <ul className="divide-y divide-border">
              {tree.map((root) => (
                <CategoryRow
                  key={root.id}
                  category={root}
                  depth={0}
                  activatingId={activatingId}
                  onEdit={(target) => setFormState({ mode: 'edit', category: target })}
                  onDeactivate={setDeactivating}
                  onActivate={handleActivate}
                />
              ))}
            </ul>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Deactivating hides a category from the storefront but keeps the record —
            switch the filter to Inactive to review and reactivate it.
          </p>
        </>
      )}

      {formState ? (
        <Modal
          title={formState.mode === 'edit' ? `Edit “${formState.category.name}”` : 'Add Category'}
          onClose={closeForm}
          persistent={saving}
        >
          <CategoryForm
            initialValue={formState.mode === 'edit' ? formState.category : null}
            categories={categories}
            onSubmit={handleFormSubmit}
            submitting={saving}
          />
        </Modal>
      ) : null}

      {deactivating ? (
        <Modal title={`Deactivate “${deactivating.name}”?`} onClose={() => !confirmingDelete && setDeactivating(null)} persistent={confirmingDelete}>
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-6 text-muted-foreground">
              This soft-deactivates the category: it disappears from the storefront
              and this list, but the record is kept. Products currently assigned
              to it keep their stored `categoryId`.
              {deactivatingChildCount > 0 ? (
                <span className="mt-2 block font-medium text-warning">
                  Note: this parent still has {deactivatingChildCount} {deactivatingChildCount === 1 ? 'subcategory' : 'subcategories'} — reassign or deactivate them separately.
                </span>
              ) : null}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setDeactivating(null)} disabled={confirmingDelete}>
                Cancel
              </Button>
              <Button variant="destructive" loading={confirmingDelete} onClick={handleDeactivate}>
                <Power size={16} aria-hidden="true" />
                Deactivate
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function CategoryRow({ category, depth, activatingId, onEdit, onDeactivate, onActivate }) {
  const children = category.children ?? [];
  const isActivating = activatingId === category.id;
  return (
    <li>
      <div
        className={cn(
          'flex min-h-[56px] items-center gap-3 px-4 py-2.5',
          depth > 0 && 'border-l-2 border-accent/60 bg-surface-muted/40',
        )}
        style={depth > 0 ? { paddingLeft: `${1 + depth * 1.25}rem` } : undefined}
      >
        <CategoryThumb image={category.image} />
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-sm', depth === 0 ? 'font-bold text-foreground' : 'font-medium text-foreground')}>
            {category.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            /{category.slug} · order {category.sortOrder}
            {depth === 0 && children.length > 0 ? ` · ${children.length} ${children.length === 1 ? 'subcategory' : 'subcategories'}` : null}
          </p>
        </div>
        <Badge tone={category.isActive ? 'success' : 'neutral'}>
          {category.isActive ? 'Active' : 'Inactive'}
        </Badge>
        <button
          type="button"
          onClick={() => onEdit(category)}
          aria-label={`Edit ${category.name}`}
          title={`Edit ${category.name}`}
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <Pencil size={17} aria-hidden="true" />
        </button>
        {category.isActive ? (
          <button
            type="button"
            onClick={() => onDeactivate(category)}
            aria-label={`Deactivate ${category.name}`}
            title={`Deactivate ${category.name}`}
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Power size={17} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onActivate(category)}
            disabled={isActivating}
            aria-label={`Reactivate ${category.name}`}
            title={`Reactivate ${category.name}`}
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:cursor-wait disabled:opacity-60"
          >
            <RotateCcw size={17} aria-hidden="true" />
          </button>
        )}
      </div>
      {children.length > 0 ? (
        <ul>
          {children.map((child) => (
            <CategoryRow
              key={child.id}
              category={child}
              depth={depth + 1}
              activatingId={activatingId}
              onEdit={onEdit}
              onDeactivate={onDeactivate}
              onActivate={onActivate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
