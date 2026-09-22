import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Plus, X } from 'lucide-react';
import { Button } from '../ui/Button.jsx';
import { Checkbox, Field, Input, Textarea } from '../ui/Field.jsx';
import { TaxonomySelectors } from './TaxonomySelectors.jsx';
import { PendingProductImages } from './PendingProductImages.jsx';
import { findCategoryById, getSubcategories } from '../../utils/taxonomy.js';
import { applyServerErrors } from '../../utils/serverErrors.js';

/**
 * Admin Product Form (create + edit) — the taxonomy section is the core.
 *
 * Layout: PRODUCT INFORMATION → Variants (create only, Variant 1 always
 * visible) → Visibility → submit.
 *
 * Two-layer taxonomy architecture (backend stores `categoryId` ONLY):
 * - UI selection `{ parentCategoryId, subcategoryId }` is always captured.
 * - `utils/productPayload.js` maps it to today's `{ categoryId }` payload
 *   and will add `subcategoryId` once the backend persists it. The
 *   subcategory is NEVER sent today and NEVER reported as persisted.
 * - Relationship validity is guaranteed by construction (dependent
 *   options) AND re-checked on submit — a subcategory from another parent
 *   cannot be submitted.
 *
 * Variants (create only): the form ALWAYS shows Variant 1 — it is never
 * hidden behind "Add Variant" (that button only adds Variant 2, 3, …).
 * At least one variant is required; the last row cannot be removed. Each
 * entry captures required SKU, name, and price (MRP/barcode/weight
 * optional) plus its OWN independent pending image collection (upload,
 * multiple selection, local previews, remove). Entries submit as backend
 * `variants[]` (inline creation returns real IDs; each variant's images
 * upload against its own real ID afterwards — never a fake ID, never
 * another variant's ID). Variant state lives outside RHF (dynamic rows);
 * per-entry errors render beside their fields. Inventory is NOT created
 * here (no backend inline capability) — it is managed per variant on the
 * edit page.
 *
 * Variant images (create only): REQUIRED — every variant needs at least
 * one VALID selected file ("Variant N requires at least one image."
 * blocks submit otherwise, attached to the offending variant). There is
 * NO standalone product-level image upload for new products: images live
 * inside their variant. The backend cannot constrain pre-ID media, so the
 * create workflow enforces it and completes the media step before the
 * operation counts as successful. Legacy/seeded imageless products remain
 * valid records and are unaffected.
 *
 * Editable fields mirror the backend contract (`createProductSchema` /
 * `updateProductSchema`): update accepts product fields only (no variants
 * key). Variant CRUD lives in `VariantManager` (rendered by the edit page
 * below this form) against the dedicated variant endpoints, with
 * per-variant galleries in `VariantMediaSection`.
 */

const DECIMAL_RE = /^\d+(\.\d+)?$/;

const productSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required.').max(255, 'Name must be ≤ 255 characters.'),
  slug: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).max(280, 'Slug must be ≤ 280 characters.').optional(),
  ),
  brand: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).max(100, 'Brand must be ≤ 100 characters.').optional(),
  ),
  shortDescription: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  description: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
});

/** Derive the form's taxonomy selection from a stored product (edit mode). */
function initialTaxonomy(product, categories) {
  const stored = product?.categoryId ? findCategoryById(categories, product.categoryId) : undefined;
  if (stored?.parentId) {
    return { parentCategoryId: stored.parentId, subcategoryId: stored.id };
  }
  return { parentCategoryId: stored?.id ?? '', subcategoryId: '' };
}

let variantKey = 0;

function blankVariant() {
  variantKey += 1;
  return { key: `variant-${variantKey}`, sku: '', name: '', price: '', compareAtPrice: '', barcode: '', weight: '' };
}

function sameFileList(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((file, index) => file === b[index]);
}

function validateVariantEntries(entries) {
  const errors = {};
  const seenSkus = new Map();
  entries.forEach((entry) => {
    const fieldErrors = {};
    const sku = entry.sku.trim();
    const name = entry.name.trim();
    const price = entry.price.trim();
    if (!sku) {
      fieldErrors.sku = 'SKU is required.';
    } else if (sku.length > 100) {
      fieldErrors.sku = 'SKU must be ≤ 100 characters.';
    } else if (seenSkus.has(sku.toLowerCase())) {
      fieldErrors.sku = 'SKU must be unique within this product.';
    } else {
      seenSkus.set(sku.toLowerCase(), entry.key);
    }
    if (!name) {
      fieldErrors.name = 'Variant name is required.';
    } else if (name.length > 150) {
      fieldErrors.name = 'Variant name must be ≤ 150 characters.';
    }
    if (!price) {
      fieldErrors.price = 'Price is required.';
    } else if (!DECIMAL_RE.test(price)) {
      fieldErrors.price = 'Price must be a non-negative number.';
    }
    if (entry.compareAtPrice.trim() !== '' && !DECIMAL_RE.test(entry.compareAtPrice.trim())) {
      fieldErrors.compareAtPrice = 'MRP must be a non-negative number.';
    }
    if (entry.barcode.trim() !== '' && entry.barcode.trim().length > 100) {
      fieldErrors.barcode = 'Barcode must be ≤ 100 characters.';
    }
    if (entry.weight.trim() !== '' && !DECIMAL_RE.test(entry.weight.trim())) {
      fieldErrors.weight = 'Weight must be a non-negative number.';
    }
    if (Object.keys(fieldErrors).length > 0) {
      errors[entry.key] = fieldErrors;
    }
  });
  return errors;
}

export function ProductForm({ initialValue = null, categories = [], onSubmit, submitting = false, mediaProgress = null }) {
  const isEdit = Boolean(initialValue?.id);
  // Taxonomy selection lives in local state (not RHF `watch`, which the
  // compiler lint flags): validity is guaranteed by the dependent options
  // and re-checked manually on submit.
  const [taxonomySelection, setTaxonomySelection] = useState(() =>
    initialTaxonomy(initialValue, categories),
  );
  // Create-mode variant rows + per-row pending image files (keyed by row).
  // Variant 1 is ALWAYS visible — the form initializes with exactly one
  // editor; "Add Variant" only appends Variant 2, 3, …. Files are File
  // objects only — no URLs/base64/store. The file-content guard breaks the
  // child-notify render loop (same files → no update).
  const [variantEntries, setVariantEntries] = useState(() => [blankVariant()]);
  const [variantErrors, setVariantErrors] = useState({});
  const [variantImages, setVariantImages] = useState({});
  const [variantImagesErrors, setVariantImagesErrors] = useState({});

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: initialValue?.name ?? '',
      slug: initialValue?.slug ?? '',
      brand: initialValue?.brand ?? '',
      shortDescription: initialValue?.shortDescription ?? '',
      description: initialValue?.description ?? '',
      isActive: initialValue?.isActive ?? true,
      isFeatured: initialValue?.isFeatured ?? false,
    },
  });

  const { parentCategoryId, subcategoryId } = taxonomySelection;

  const handleVariantImages = useCallback((key, files) => {
    setVariantImages((previous) => {
      const current = previous[key] ?? [];
      if (sameFileList(current, files)) return previous;
      return { ...previous, [key]: files };
    });
    // Clear a stale per-variant image error ONLY when the variant now has a
    // selection. The child's notify effect also fires on mount and on every
    // parent re-render (inline callback identity) reporting the unchanged
    // files — usually `[]` — which must NOT wipe a just-set validation
    // error (same guard rationale as `sameFileList` above).
    if (files.length > 0) {
      setVariantImagesErrors((previous) => {
        if (!previous[key]) return previous;
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
  }, []);

  const updateVariantEntry = (key, patch) => {
    setVariantEntries((previous) => previous.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
    setVariantErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const addVariantEntry = () => {
    setVariantEntries((previous) => [...previous, blankVariant()]);
  };

  const removeVariantEntry = (key) => {
    // At least one variant is required — the last row cannot be removed.
    if (variantEntries.length <= 1) return;
    setVariantEntries((previous) => previous.filter((entry) => entry.key !== key));
    setVariantErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setVariantImages((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setVariantImagesErrors((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const submit = handleSubmit(async (values) => {
    if (!parentCategoryId) {
      setError('parentCategoryId', { type: 'validate', message: 'Parent category is required.' });
      return;
    }
    // Relationship re-check (defense in depth — options already constrain).
    if (subcategoryId) {
      const valid = getSubcategories(categories, parentCategoryId).some(
        (sub) => sub.id === subcategoryId,
      );
      if (!valid) {
        setError('subcategoryId', {
          type: 'validate',
          message: 'This subcategory does not belong to the selected parent.',
        });
        return;
      }
    }
    // Variant rows validate as a set (create mode only): at least one
    // variant, valid fields, AND at least one image per variant.
    let variants = null;
    if (!isEdit) {
      if (variantEntries.length === 0) {
        setError('root', { type: 'validate', message: 'At least one variant is required.' });
        return;
      }
      const entryErrors = validateVariantEntries(variantEntries);
      setVariantErrors(entryErrors);
      if (Object.keys(entryErrors).length > 0) {
        return;
      }
      // Per-variant image requirement — attached to the offending variant.
      const imageErrors = {};
      variantEntries.forEach((entry, index) => {
        if ((variantImages[entry.key] ?? []).length === 0) {
          imageErrors[entry.key] = `Variant ${index + 1} requires at least one image.`;
        }
      });
      setVariantImagesErrors(imageErrors);
      if (Object.keys(imageErrors).length > 0) {
        return;
      }
      variants = variantEntries.map((entry) => ({
        sku: entry.sku.trim(),
        name: entry.name.trim(),
        price: entry.price.trim(),
        compareAtPrice: entry.compareAtPrice.trim(),
        barcode: entry.barcode.trim(),
        weight: entry.weight.trim(),
      }));
    }
    try {
      await onSubmit(
        {
          parentCategoryId,
          subcategoryId: subcategoryId || '',
          fields: values,
          variants,
        },
        // Second arg mirrors the CategoryForm imageAction pattern: pending
        // files for the caller to upload once real IDs exist. Variant files
        // keyed by SKU (unique) for matching created variants. There is no
        // product-level image collection for new products — every image
        // belongs to its variant. Edit mode sends null
        // (VariantManager/VariantMediaSection own existing media).
        isEdit
          ? null
          : {
              variantImages: variantEntries.map((entry) => ({ sku: entry.sku.trim(), files: variantImages[entry.key] ?? [] })),
            },
      );
    } catch (error) {
      const root = applyServerErrors(error?.details, setError);
      const code = error?.code;
      if (code === 'CATEGORY_NOT_FOUND') {
        setError('parentCategoryId', { type: 'server', message: 'Selected category no longer exists. Refresh and retry.' });
      } else if (code === 'PRODUCT_SLUG_EXISTS') {
        setError('slug', { type: 'server', message: 'This product slug is already taken.' });
      } else if (code === 'PRODUCT_VARIANT_SKU_EXISTS' || code === 'SKU') {
        setError('root', { type: 'server', message: 'A variant SKU is already taken. Edit the SKU and retry.' });
      } else if (code === 'PRODUCT_VARIANT_BARCODE_EXISTS') {
        setError('root', { type: 'server', message: 'A variant barcode is already taken. Edit it and retry.' });
      } else {
        setError('root', { type: 'server', message: root ?? error?.message ?? 'Save failed. Please try again.' });
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <section aria-label="Product information" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Product information</h3>

        <TaxonomySelectors
          categories={categories}
          parentCategoryId={parentCategoryId}
          subcategoryId={subcategoryId}
          onParentChange={(value) => {
            clearErrors(['parentCategoryId', 'subcategoryId']);
            setTaxonomySelection({ parentCategoryId: value, subcategoryId: '' });
          }}
          onSubcategoryChange={(value) => {
            clearErrors('subcategoryId');
            setTaxonomySelection((previous) => ({ ...previous, subcategoryId: value }));
          }}
          parentError={errors.parentCategoryId?.message}
          subcategoryError={errors.subcategoryId?.message}
        />

        <p className="flex items-start gap-2 rounded-lg bg-surface-muted px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
          <Info size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            Subcategory assignment will be available when backend product hierarchy
            support is added. Today only the parent category is stored
            (`categoryId`); the subcategory selection is kept as form state.
          </span>
        </p>

        <Field label="Product name" required error={errors.name?.message}>
          {({ errorId }) => (
            <Input placeholder="e.g. DriveCharge 38W" aria-invalid={Boolean(errors.name)} aria-describedby={errorId} {...register('name')} />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Slug" hint="Optional — auto-derived from the name." error={errors.slug?.message}>
            {({ errorId }) => (
              <Input placeholder="e.g. drivecharge-38w" aria-invalid={Boolean(errors.slug)} aria-describedby={errorId} {...register('slug')} />
            )}
          </Field>
          <Field label="Brand" error={errors.brand?.message}>
            {({ errorId }) => (
              <Input placeholder="e.g. Tech Pulse" aria-invalid={Boolean(errors.brand)} aria-describedby={errorId} {...register('brand')} />
            )}
          </Field>
        </div>

        <Field label="Short description" error={errors.shortDescription?.message}>
          {({ errorId }) => (
            <Textarea placeholder="One-line selling point…" aria-invalid={Boolean(errors.shortDescription)} aria-describedby={errorId} {...register('shortDescription')} />
          )}
        </Field>
        <Field label="Description" error={errors.description?.message}>
          {({ errorId }) => (
            <Textarea rows={5} placeholder="Full product description…" aria-invalid={Boolean(errors.description)} aria-describedby={errorId} {...register('description')} />
          )}
        </Field>
      </section>

      {!isEdit ? (
        <section aria-label="Variants" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Variants</h3>
            <button
              type="button"
              onClick={addVariantEntry}
              disabled={submitting}
              className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus size={16} aria-hidden="true" />
              Add Variant
            </button>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Products sell by variant — Variant 1 is always shown. Use “Add Variant” for Variant 2, 3, ….
            Each variant owns its images below (at least one required); inventory is managed per variant on the edit page.
          </p>
          {variantEntries.map((entry, index) => {
            const entryErrors = variantErrors[entry.key] ?? {};
            const imagesError = variantImagesErrors[entry.key] ?? null;
            return (
                <div
                  key={entry.key}
                  role="group"
                  aria-label={`Variant ${index + 1}`}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted/40 p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-foreground">Variant {index + 1}</h4>
                    <button
                      type="button"
                      onClick={() => removeVariantEntry(entry.key)}
                      disabled={submitting || variantEntries.length <= 1}
                      title={variantEntries.length <= 1 ? 'At least one variant is required.' : undefined}
                      aria-label={`Remove variant ${index + 1}`}
                      className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-surface-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <X size={15} aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="SKU" required error={entryErrors.sku}>
                      <Input
                        placeholder="e.g. TP-DC38-BLK"
                        value={entry.sku}
                        onChange={(event) => updateVariantEntry(entry.key, { sku: event.target.value })}
                        disabled={submitting}
                        autoComplete="off"
                        aria-invalid={Boolean(entryErrors.sku)}
                      />
                    </Field>
                    <Field label="Variant name" required error={entryErrors.name}>
                      <Input
                        placeholder="e.g. Onyx Black"
                        value={entry.name}
                        onChange={(event) => updateVariantEntry(entry.key, { name: event.target.value })}
                        disabled={submitting}
                        autoComplete="off"
                        aria-invalid={Boolean(entryErrors.name)}
                      />
                    </Field>
                    <Field label="Price (INR)" required error={entryErrors.price}>
                      <Input
                        inputMode="decimal"
                        placeholder="e.g. 1299.00"
                        value={entry.price}
                        onChange={(event) => updateVariantEntry(entry.key, { price: event.target.value })}
                        disabled={submitting}
                        autoComplete="off"
                        aria-invalid={Boolean(entryErrors.price)}
                      />
                    </Field>
                    <Field label="MRP / Compare-at (INR)" error={entryErrors.compareAtPrice}>
                      <Input
                        inputMode="decimal"
                        placeholder="Optional"
                        value={entry.compareAtPrice}
                        onChange={(event) => updateVariantEntry(entry.key, { compareAtPrice: event.target.value })}
                        disabled={submitting}
                        autoComplete="off"
                        aria-invalid={Boolean(entryErrors.compareAtPrice)}
                      />
                    </Field>
                    <Field label="Barcode" error={entryErrors.barcode}>
                      <Input
                        placeholder="Optional"
                        value={entry.barcode}
                        onChange={(event) => updateVariantEntry(entry.key, { barcode: event.target.value })}
                        disabled={submitting}
                        autoComplete="off"
                        aria-invalid={Boolean(entryErrors.barcode)}
                      />
                    </Field>
                    <Field label="Weight" error={entryErrors.weight}>
                      <Input
                        inputMode="decimal"
                        placeholder="Optional"
                        value={entry.weight}
                        onChange={(event) => updateVariantEntry(entry.key, { weight: event.target.value })}
                        disabled={submitting}
                        autoComplete="off"
                        aria-invalid={Boolean(entryErrors.weight)}
                      />
                    </Field>
                  </div>
                  <PendingProductImages
                    key={entry.key}
                    title={`Variant ${index + 1} images (required)`}
                    hint="REQUIRED — at least one image (JPEG, PNG, or WebP · max 5 MB each). These upload against this variant once it exists; the first file becomes the variant's primary image."
                    onSelectionChange={(files) => handleVariantImages(entry.key, files)}
                    disabled={submitting}
                  />
                  {imagesError ? (
                    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
                      {imagesError}
                    </p>
                  ) : null}
                </div>
            );
          })}
        </section>
      ) : null}

      <section aria-label="Visibility" className="flex flex-col gap-1 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Visibility</h3>
        <Checkbox label="Active (visible in storefront)" {...register('isActive')} />
        <Checkbox label="Featured (eligible for curated rails)" {...register('isFeatured')} />
      </section>

      {errors.root?.message ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
          {errors.root.message}
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={submitting} className="w-full sm:w-auto sm:px-8">
          {isEdit ? 'Save changes' : 'Create product'}
        </Button>
        {mediaProgress ? (
          <p role="status" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
            {mediaProgress}
          </p>
        ) : null}
      </div>
    </form>
  );
}
