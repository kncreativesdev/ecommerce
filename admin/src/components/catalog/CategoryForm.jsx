import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ImagePlus, X } from 'lucide-react';
import { Button } from '../ui/Button.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../ui/Field.jsx';
import { getForbiddenParentIds, getParentCategories } from '../../utils/taxonomy.js';
import { applyServerErrors } from '../../utils/serverErrors.js';
import {
  MEDIA_ALLOWED_MIME_TYPES,
  MEDIA_MAX_FILE_SIZE,
  isManagedCategoryImage,
  resolveCategoryImageUrl,
} from '../../services/media.service.js';

/**
 * Reusable category form (create + edit). Editable fields mirror the
 * backend contract EXACTLY (`createCategorySchema`/`updateCategorySchema`):
 * name*, slug?, description?, image?, parentId?, isActive?, sortOrder?.
 *
 * The Parent Category selector IS the subcategory mechanism: choosing a
 * parent submits `parentId` (subcategory); "None" submits explicit `null`,
 * which the backend stores as top-level — including promotion of a
 * subcategory to top-level on update. Client-side guards exclude the row
 * itself + descendants (self-parent and cycles are also re-validated
 * server-side).
 *
 * Image handling: the `image` contract field stays a ≤500-char string
 * reference, edited as text and/or replaced by a real file upload.
 * A chosen file is previewed locally and uploaded by the caller AFTER the
 * record exists (`onSubmit(payload, imageAction)`); removal nulls the
 * reference and (for backend-managed files) deletes the stored file.
 */

const emptyToUndefined = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(150, 'Name must be ≤ 150 characters.'),
  slug: z
    .preprocess(emptyToUndefined, z.string().trim().min(1).max(180, 'Slug must be ≤ 180 characters.').optional()),
  description: z.preprocess(
    (value) => (value === '' ? null : value),
    z.string().trim().nullable().optional(),
  ),
  image: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(500, 'Image must be ≤ 500 characters.').nullable().optional()),
  parentId: z.string().optional(),
  sortOrder: z.coerce.number().int('Sort order must be a whole number.').min(0, 'Sort order can’t be negative.'),
  isActive: z.boolean(),
});

export function CategoryForm({ initialValue = null, categories = [], onSubmit, submitting = false, serverError = null }) {
  const isEdit = Boolean(initialValue?.id);
  const forbidden = getForbiddenParentIds(categories, initialValue?.id);
  const parents = getParentCategories(categories).filter((category) => !forbidden.includes(category.id));
  const existingImage = typeof initialValue?.image === 'string' ? initialValue.image : '';

  const [pendingFile, setPendingFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [removeRequested, setRemoveRequested] = useState(false);
  const fileInputRef = useRef(null);

  // Revoke local preview URLs on replacement/unmount (never upload blobs
  // anywhere except the documented multipart endpoint at submit time).
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: initialValue?.name ?? '',
      slug: initialValue?.slug ?? '',
      description: initialValue?.description ?? '',
      image: initialValue?.image ?? '',
      parentId: initialValue?.parentId ?? '',
      sortOrder: initialValue?.sortOrder ?? 0,
      isActive: initialValue?.isActive ?? true,
    },
  });

  const submit = handleSubmit(async (values) => {
    // Strict payload: only documented fields. "None" → explicit null so the
    // backend stores top-level (create) or promotes to top-level (update).
    const payload = {
      name: values.name.trim(),
      ...(values.slug ? { slug: values.slug.trim() } : {}),
      description: values.description?.trim() ? values.description.trim() : null,
      image: removeRequested ? null : (values.image?.trim() ? values.image.trim() : null),
      parentId: values.parentId && values.parentId !== '' ? values.parentId : null,
      sortOrder: values.sortOrder,
      isActive: values.isActive,
    };
    // A chosen file wins over any text reference: the caller uploads it
    // after the record exists and the endpoint sets `image` to the stored
    // reference. Removal of a backend-managed file is handled by the
    // caller's delete endpoint; other references are simply nulled above.
    const imageAction = pendingFile
      ? { file: pendingFile }
      : removeRequested
        ? { remove: true, hadManagedImage: isManagedCategoryImage(existingImage) }
        : null;
    // For edits, drop keys identical to the stored row so an untouched save
    // never trips `422 CATEGORY_UPDATE_INVALID`... except the backend
    // compares presence, not equality: send the full documented subset and
    // let the page disable saving when untouched (handled by caller).
    try {
      await onSubmit(payload, imageAction);
    } catch (error) {
      const root = applyServerErrors(error?.details, setError);
      const code = error?.code;
      if (code === 'CATEGORY_SLUG_EXISTS') {
        setError('slug', { type: 'server', message: 'This slug is already taken.' });
      } else if (code === 'CATEGORY_PARENT_NOT_FOUND') {
        setError('parentId', { type: 'server', message: 'Selected parent no longer exists. Refresh and retry.' });
      } else if (code === 'CATEGORY_SELF_PARENT' || code === 'CATEGORY_CYCLE') {
        setError('parentId', { type: 'server', message: error?.message ?? 'Invalid parent selection.' });
      } else if (code === 'CATEGORY_UPDATE_INVALID') {
        setError('root', { type: 'server', message: 'No changes to save.' });
      } else if (typeof code === 'string' && (code.startsWith('MEDIA_') || code === 'FILE_TOO_LARGE')) {
        // Image upload failures (thrown by the caller after the record
        // save): surfaced on the upload section; the page already toasted.
        setError('imageFile', { type: 'server', message: error?.message ?? 'Image upload failed. Please try again.' });
      } else {
        setError('root', { type: 'server', message: root ?? error?.message ?? 'Save failed. Please try again.' });
      }
    }
  });

  const shownImageUrl = pendingFile && previewUrl
    ? previewUrl
    : !removeRequested
      ? resolveCategoryImageUrl(existingImage)
      : null;

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] ?? null;
    // Reset the input so the same file can be re-chosen after removal.
    event.target.value = '';
    if (!file) return;
    if (!MEDIA_ALLOWED_MIME_TYPES.includes(file.type)) {
      setError('imageFile', { type: 'validate', message: 'Only JPEG, PNG, and WebP images are allowed.' });
      return;
    }
    if (file.size > MEDIA_MAX_FILE_SIZE) {
      setError('imageFile', { type: 'validate', message: 'Image exceeds the maximum allowed size of 5MB.' });
      return;
    }
    if (file.size === 0) {
      setError('imageFile', { type: 'validate', message: 'The selected file is empty.' });
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    clearErrors('imageFile');
    setRemoveRequested(false);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleRemoveImage = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(null);
    setPreviewUrl(null);
    setRemoveRequested(true);
    clearErrors('imageFile');
  };

  const handleUndoRemove = () => {
    setRemoveRequested(false);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Name" required error={errors.name?.message}>
        {({ errorId }) => (
          <Input placeholder="e.g. Car Chargers" aria-invalid={Boolean(errors.name)} aria-describedby={errorId} {...register('name')} />
        )}
      </Field>

      <Field
        label="Slug"
        hint="Optional — auto-derived from the name when left blank. Must stay unique."
        error={errors.slug?.message}
      >
        {({ errorId }) => (
          <Input placeholder="e.g. car-chargers" aria-invalid={Boolean(errors.slug)} aria-describedby={errorId} {...register('slug')} />
        )}
      </Field>

      <Field label="Description" error={errors.description?.message}>
        {({ errorId }) => (
          <Textarea placeholder="Short category description…" aria-invalid={Boolean(errors.description)} aria-describedby={errorId} {...register('description')} />
        )}
      </Field>

      <Field
        label="Parent Category"
        required
        hint={
          isEdit && initialValue?.parentId
            ? '“None” promotes this subcategory to a top-level category.'
            : '“None” creates a top-level category. Any parent creates a subcategory of that parent.'
        }
        error={errors.parentId?.message}
      >
        {({ errorId }) => (
          <Select aria-invalid={Boolean(errors.parentId)} aria-describedby={errorId} {...register('parentId')}>
            <option value="">None — top-level category</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Image reference" hint="Optional metadata string (≤ 500 chars). A chosen file below replaces it on save." error={errors.image?.message}>
          {({ errorId }) => (
            <Input placeholder="e.g. categories/car-chargers.webp" aria-invalid={Boolean(errors.image)} aria-describedby={errorId} {...register('image')} />
          )}
        </Field>
        <Field label="Sort order" hint="Ascending display order." error={errors.sortOrder?.message}>
          {({ errorId }) => (
            <Input type="number" min={0} step={1} aria-invalid={Boolean(errors.sortOrder)} aria-describedby={errorId} {...register('sortOrder')} />
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-foreground">Category image</legend>
        <p className="text-xs leading-5 text-muted-foreground">
          JPEG, PNG, or WebP up to 5MB. Stored as WebP and previewed from the backend.
        </p>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="inline-flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-muted">
            {shownImageUrl ? (
              <img src={shownImageUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <ImagePlus size={22} className="text-muted-foreground" />
            )}
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            {pendingFile ? (
              <p className="truncate text-xs text-muted-foreground">
                {pendingFile.name} — uploads when you save.
              </p>
            ) : removeRequested ? (
              <p className="text-xs text-muted-foreground">
                Image will be removed when you save.{' '}
                <button
                  type="button"
                  onClick={handleUndoRemove}
                  className="cursor-pointer font-semibold text-accent-link hover:no-underline"
                >
                  Undo
                </button>
              </p>
            ) : existingImage ? (
              <p className="truncate text-xs text-muted-foreground">{existingImage}</p>
            ) : (
              <p className="text-xs text-muted-foreground">No image yet.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                aria-label={existingImage || pendingFile ? 'Replace category image' : 'Choose category image'}
                className="sr-only"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting}
              >
                {existingImage || pendingFile ? 'Replace…' : 'Choose file…'}
              </Button>
              {shownImageUrl || removeRequested ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleRemoveImage}
                  disabled={submitting}
                >
                  <X size={15} aria-hidden="true" />
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        {errors.imageFile?.message ? (
          <p role="alert" className="text-xs font-medium text-destructive">{errors.imageFile.message}</p>
        ) : null}
      </fieldset>

      <Checkbox label="Active (visible in storefront)" {...register('isActive')} />

      {errors.root?.message || serverError ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
          {errors.root?.message ?? serverError}
        </p>
      ) : null}

      <Button type="submit" loading={submitting} className="w-full">
        {isEdit ? 'Save changes' : 'Create category'}
      </Button>
    </form>
  );
}
