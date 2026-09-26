import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ImagePlus, Pencil, Image as ImageIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Table } from '../ui/Table.jsx';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { ErrorState } from '../ui/ErrorState.jsx';
import { Modal } from '../ui/Modal.jsx';
import { Field, Input, Select, Checkbox } from '../ui/Field.jsx';
import { applyServerErrors } from '../../utils/serverErrors.js';
import { validateChosenFile } from '../../utils/imageSelection.js';
import {
  deleteProductImage,
  fetchProductImages,
  resolveImageUrl,
  updateImageMetadata,
  uploadProductImage,
} from '../../services/media.service.js';

/**
 * General/legacy product-media section for the product edit page. Gallery
 * table (with previews) + Upload modal (one or several files + optional
 * per-upload metadata) + metadata Edit modal + Delete confirm + full-size
 * preview.
 *
 * Compatibility role: this gallery manages product-level images
 * (`variantId: null`) — legacy rows created before variant media plus the
 * storefront fallback gallery. Per-variant galleries live in
 * `VariantMediaSection` above and are the authoritative workflow for new
 * media; nothing here is auto-reassigned to a variant and nothing here is
 * deleted automatically.
 *
 * Backend semantics (verified `media.*` + storefront readers): the gallery
 * orders by `sortOrder` (then oldest first); the storefront shows the
 * first `isPrimary` image, else the first in that order. `isPrimary` and
 * `sortOrder` are therefore real merchandising fields — editable per
 * image, never invented client-side. Uploaded files are served statically
 * by the API server; every image renders through `MediaThumb` with a
 * neutral fallback when the file is missing.
 */

const MEDIA_COLUMNS = [
  { key: 'preview', label: 'Preview' },
  { key: 'filename', label: 'File' },
  { key: 'altText', label: 'Alt text' },
  { key: 'sortOrder', label: 'Sort', numeric: true },
  { key: 'primary', label: 'Primary' },
  { key: 'actions', label: 'Actions', numeric: true },
];

/** Large preview (same served URL — browser cache, no second fetch). */
function PreviewImage({ image }) {
  const [failed, setFailed] = useState(false);
  const url = resolveImageUrl(image);
  if (!url || failed) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-muted p-4">
        <MediaThumb image={image} size="h-16 w-16" />
        <p className="text-sm text-muted-foreground">The image file is unavailable.</p>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={image.altText || image.filename}
      onError={() => setFailed(true)}
      className="max-h-[60svh] w-full rounded-xl border border-border bg-surface-muted object-contain"
    />
  );
}

/** Thumbnail with graceful fallback (no layout collapse on 404). */
function MediaThumb({ image, size = 'h-14 w-14' }) {
  const [failed, setFailed] = useState(false);
  const url = resolveImageUrl(image);
  if (!url || failed) {
    return (
      <span
        aria-hidden="true"
        title={url ? 'Image file unavailable' : undefined}
        className={`inline-flex ${size} items-center justify-center rounded-lg bg-surface-muted text-muted-foreground`}
      >
        <ImageIcon size={22} />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${size} rounded-lg border border-border bg-surface-muted object-contain`}
    />
  );
}

const uploadSchema = z.object({
  altText: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(255, 'Alt text must be ≤ 255 characters.').optional(),
  ),
  sortOrder: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().min(0, 'Sort order must be 0 or higher.').optional(),
  ),
  isPrimary: z.boolean(),
  variantId: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().optional(),
  ),
});

let chosenFileId = 0;

function UploadForm({ productId, variants, submitting, setSubmitting, onDone, onCancel }) {
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(uploadSchema),
    defaultValues: { altText: '', sortOrder: '', isPrimary: false, variantId: '' },
  });
  const busy = isSubmitting || submitting;

  // Chosen files live outside RHF: each entry carries its own validation
  // result so one bad file never blocks the valid ones. Object URLs are
  // local previews only — revoked on remove/replace/unmount, never
  // persisted, never confused with server media URLs.
  const [chosen, setChosen] = useState([]); // [{ id, file, name, url, error }]
  const [progress, setProgress] = useState(null); // "Uploading 2 of 3…" | null
  const [failed, setFailed] = useState([]); // [{ name, message }]
  const urlsRef = useRef(new Map());

  useEffect(
    () => () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current.clear();
    },
    [],
  );

  const validChosen = chosen.filter((entry) => !entry.error);
  const singleMode = validChosen.length <= 1;

  const handleFilesChange = (event) => {
    const picked = Array.from(event.target.files ?? []);
    // Reset the input so the same files can be re-chosen after removal.
    event.target.value = '';
    if (picked.length === 0) return;
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current.clear();
    setFailed([]);
    clearErrors('files');
    setChosen(
      picked.map((file) => {
        const error = validateChosenFile(file);
        const id = `chosen-${chosenFileId++}`;
        let url = null;
        if (!error) {
          url = URL.createObjectURL(file);
          urlsRef.current.set(id, url);
        }
        return { id, file, name: file.name, url, error };
      }),
    );
  };

  const removeChosen = (id) => {
    const url = urlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(id);
    }
    setChosen((entries) => entries.filter((entry) => entry.id !== id));
    setFailed([]);
  };

  const submit = handleSubmit(async (values) => {
    if (validChosen.length === 0) {
      setError('files', {
        type: 'validate',
        message:
          chosen.length > 0
            ? 'Every selected file was rejected — choose at least one valid image.'
            : 'Choose at least one image file.',
      });
      return;
    }
    setSubmitting(true);
    setFailed([]);
    const failures = [];
    let uploaded = 0;
    // The backend accepts one file per request — upload sequentially so a
    // single failure never aborts the rest (no atomic multi-file
    // transaction exists; partial success is reported truthfully below).
    for (let index = 0; index < validChosen.length; index += 1) {
      const entry = validChosen[index];
      if (validChosen.length > 1) setProgress(`Uploading ${index + 1} of ${validChosen.length}…`);
      try {
        await uploadProductImage(productId, {
          file: entry.file,
          // Per-file metadata applies to the single-file case; batch
          // uploads take backend defaults and are edited per image after.
          altText: singleMode ? values.altText : undefined,
          sortOrder: singleMode ? values.sortOrder : undefined,
          isPrimary: singleMode ? values.isPrimary === true : false,
          variantId: singleMode ? values.variantId : undefined,
        });
        uploaded += 1;
      } catch (error) {
        const code = error?.code;
        failures.push({
          name: entry.name,
          message:
            code === 'MEDIA_INVALID_TYPE'
              ? 'Only JPEG, PNG, or WebP images are allowed.'
              : code === 'MEDIA_FILE_TOO_LARGE'
                ? 'Image must be 5 MB or smaller.'
                : code === 'PRODUCT_VARIANT_NOT_FOUND'
                  ? 'Selected variant no longer exists.'
                  : (error?.message ?? 'Upload failed. Please try again.'),
        });
        if (code === 'PRODUCT_NOT_FOUND') break;
      }
    }
    setProgress(null);
    setSubmitting(false);
    if (uploaded > 0) {
      toast.success(
        uploaded === 1 && failures.length === 0
          ? 'Image uploaded.'
          : `${uploaded} ${uploaded === 1 ? 'image' : 'images'} uploaded.`,
      );
    }
    if (failures.length > 0) {
      setFailed(failures);
      if (uploaded > 0) {
        toast.error(
          `${failures.length} ${failures.length === 1 ? 'image' : 'images'} failed — successful uploads are kept.`,
        );
      }
      onDone({ close: false });
    } else {
      onDone({ close: true });
    }
  });

  return (
    <form onSubmit={submit} noValidate aria-label="Upload images" className="flex flex-col gap-4">
      <Field label="Image files" required error={errors.files?.message}>
        {({ errorId }) => (
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            aria-invalid={Boolean(errors.files)}
            aria-describedby={errorId}
            onChange={handleFilesChange}
            className="min-h-[44px] w-full cursor-pointer rounded-lg border border-input bg-surface px-3.5 py-2.5 text-sm text-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-foreground hover:border-border-strong"
          />
        )}
      </Field>
      <p className="-mt-2 text-xs text-muted-foreground">JPEG, PNG, or WebP · max 5 MB each · you can select several files.</p>
      {chosen.length > 0 ? (
        <ul aria-label="Selected files" className="flex flex-col gap-2">
          {chosen.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted/50 p-2.5"
            >
              {entry.url ? (
                <img src={entry.url} alt="" className="h-12 w-12 shrink-0 rounded-md border border-border bg-surface-muted object-contain" />
              ) : (
                <span aria-hidden="true" className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-surface-muted text-muted-foreground">
                  <ImageIcon size={18} />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium text-foreground">{entry.name}</span>
                {entry.error ? (
                  <span role="alert" className="text-xs font-medium text-destructive">{entry.error}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Ready to upload</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => removeChosen(entry.id)}
                disabled={busy}
                aria-label={`Remove ${entry.name} from selection`}
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {singleMode ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Alt text" hint="Optional, ≤ 255 characters." error={errors.altText?.message}>
              {({ errorId }) => (
                <Input placeholder="e.g. Front view, onyx black" aria-invalid={Boolean(errors.altText)} aria-describedby={errorId} {...register('altText')} />
              )}
            </Field>
            <Field label="Sort order" hint="Optional, 0 first." error={errors.sortOrder?.message}>
              {({ errorId }) => (
                <Input inputMode="numeric" placeholder="e.g. 0" aria-invalid={Boolean(errors.sortOrder)} aria-describedby={errorId} {...register('sortOrder')} />
              )}
            </Field>
          </div>
          {Array.isArray(variants) && variants.length > 0 ? (
            <Field label="Link to variant" hint="Optional." error={errors.variantId?.message}>
              {({ errorId }) => (
                <Select aria-describedby={errorId} {...register('variantId')}>
                  <option value="">Product-level image</option>
                  {variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.sku} — {variant.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Checkbox label="Set as primary image" {...register('isPrimary')} />
        </>
      ) : (
        <p className="rounded-lg border border-border bg-surface-muted/50 px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
          Uploading {validChosen.length} images with default metadata — set alt text, order,
          variant links, and the primary flag per image after upload.
        </p>
      )}
      {failed.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5">
          <p className="text-sm font-semibold text-destructive">
            {failed.length} {failed.length === 1 ? 'upload' : 'uploads'} failed — successful uploads are kept.
          </p>
          <ul className="flex flex-col gap-0.5">
            {failed.map((item) => (
              <li key={item.name} className="text-xs text-destructive">
                <span className="font-mono font-semibold">{item.name}</span>: {item.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {progress ? (
        <p role="status" className="text-sm font-medium text-muted-foreground">{progress}</p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          {validChosen.length > 1 ? `Upload ${validChosen.length} images` : 'Upload image'}
        </Button>
      </div>
    </form>
  );
}

const metadataSchema = z.object({
  altText: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(255, 'Alt text must be ≤ 255 characters.').optional(),
  ),
  sortOrder: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().min(0, 'Sort order must be 0 or higher.').optional(),
  ),
  isPrimary: z.boolean(),
  variantId: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().optional(),
  ),
});

function MetadataForm({ initialValue, variants, submitting, onSubmit, onCancel }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(metadataSchema),
    defaultValues: {
      altText: initialValue?.altText ?? '',
      sortOrder: initialValue?.sortOrder ?? '',
      isPrimary: initialValue?.isPrimary ?? false,
      variantId: initialValue?.variantId ?? '',
    },
  });

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit({
        altText: values.altText,
        sortOrder: values.sortOrder,
        isPrimary: values.isPrimary,
        variantId: values.variantId ? values.variantId : null,
      });
    } catch (error) {
      const root = applyServerErrors(error?.details, setError);
      const code = error?.code;
      if (code === 'PRODUCT_VARIANT_NOT_FOUND') {
        setError('variantId', { type: 'server', message: 'Selected variant no longer exists.' });
      } else {
        setError('root', { type: 'server', message: root ?? error?.message ?? 'Save failed. Please try again.' });
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate aria-label="Edit image metadata" className="flex flex-col gap-4">
      <Field label="Alt text" hint="Optional, ≤ 255 characters." error={errors.altText?.message}>
        {({ errorId }) => (
          <Input aria-invalid={Boolean(errors.altText)} aria-describedby={errorId} {...register('altText')} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sort order" hint="0 shows first." error={errors.sortOrder?.message}>
          {({ errorId }) => (
            <Input inputMode="numeric" aria-invalid={Boolean(errors.sortOrder)} aria-describedby={errorId} {...register('sortOrder')} />
          )}
        </Field>
        {Array.isArray(variants) && variants.length > 0 ? (
          <Field label="Link to variant" error={errors.variantId?.message}>
            {({ errorId }) => (
              <Select aria-describedby={errorId} {...register('variantId')}>
                <option value="">Product-level image</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.sku} — {variant.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </div>
      <Checkbox label="Primary image" {...register('isPrimary')} />
      {errors.root?.message ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
          {errors.root.message}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

export function MediaManager({ productId, productName, variants = [] }) {
  const [images, setImages] = useState([]);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadKey, setUploadKey] = useState(0);
  const [editing, setEditing] = useState(null); // image | null
  const [deleting, setDeleting] = useState(null); // image | null
  const [previewing, setPreviewing] = useState(null); // image | null
  const [mutating, setMutating] = useState(false);
  const [prevProductId, setPrevProductId] = useState(productId);

  // Render-time reset on product change (sanctioned derived-state pattern);
  // the effect below only syncs the async fetch.
  if (prevProductId !== productId) {
    setPrevProductId(productId);
    setImages([]);
    setLoadError(null);
    setStatus('loading');
  }

  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    const signal = controller.signal;
    fetchProductImages(productId)
      .then((data) => {
        if (signal.aborted) return;
        setImages([...data].sort((a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0)));
        setStatus('success');
      })
      .catch((error) => {
        if (signal.aborted) return;
        setLoadError(error);
        setStatus('error');
      });
    return () => controller.abort();
  }, [productId, reloadToken]);

  const refresh = () => setReloadToken((token) => token + 1);

  const openUpload = () => {
    setUploadKey((key) => key + 1);
    setUploadOpen(true);
  };

  const handleDelete = async () => {
    if (!productId || !deleting?.id) return;
    setMutating(true);
    try {
      await deleteProductImage(productId, deleting.id);
      toast.success(`Image “${deleting.filename}” deleted.`);
      setDeleting(null);
      refresh();
    } catch (error) {
      if (error?.status === 404 || error?.code === 'MEDIA_NOT_FOUND') {
        toast.success('Image already deleted.');
        setDeleting(null);
        refresh();
      } else {
        toast.error(error?.message ?? 'Delete failed. Please try again.');
      }
    } finally {
      setMutating(false);
    }
  };

  const handleMetadataSave = async (patch) => {
    if (!productId || !editing?.id) return;
    setMutating(true);
    try {
      await updateImageMetadata(productId, editing.id, patch);
      toast.success('Image metadata saved.');
      setEditing(null);
      refresh();
    } catch (error) {
      if (error?.status === 404 || error?.code === 'MEDIA_NOT_FOUND' || error?.code === 'PRODUCT_NOT_FOUND') {
        toast.error('This image no longer exists — list refreshed.');
        setEditing(null);
        refresh();
        return;
      }
      throw error;
    } finally {
      setMutating(false);
    }
  };

  return (
    <section aria-label="General product media" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">General product media</h3>
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            {status === 'loading'
              ? 'Loading images…'
              : `${images.length} ${images.length === 1 ? 'image' : 'images'} · JPEG/PNG/WebP, ≤ 5 MB each`}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            Legacy / general product gallery (images with no variant). New products attach images inside their
            variant — manage per-variant galleries in “Variant images” above. Existing general images stay readable
            as the storefront fallback and are never auto-reassigned to a variant.
          </p>
        </div>
        <Button size="sm" onClick={openUpload} disabled={!productId || status === 'loading'}>
          <ImagePlus size={15} aria-hidden="true" />
          Upload image
        </Button>
      </div>

      {status === 'loading' ? (
        <div role="status" aria-label="Loading images" className="flex flex-col gap-2">
          {[0, 1].map((index) => (
            <div key={index} aria-hidden="true" className="h-20 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : status === 'error' ? (
        <ErrorState
          title="Couldn’t load images"
          message={loadError?.message ?? 'Please try again.'}
          onRetry={refresh}
        />
      ) : images.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="No images yet"
          message="Upload the first product image. It is converted to WebP and appears on the storefront gallery."
        />
      ) : (
        <Table caption={`Images of ${productName ?? 'this product'}`} columns={MEDIA_COLUMNS} minWidth="min-w-[760px]">
          {images.map((image) => (
            <tr key={image.id} className="transition-colors hover:bg-surface-muted/50">
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => setPreviewing(image)}
                  aria-label={`View larger image of ${image.altText || image.filename}`}
                  title="View larger image"
                  className="cursor-pointer rounded-lg transition-opacity hover:opacity-85 focus-visible:outline-none"
                >
                  <MediaThumb image={image} />
                </button>
              </td>
              <td className="px-4 py-3">
                <p className="max-w-[220px] truncate font-mono text-[13px] font-semibold text-foreground" title={image.filename}>
                  {image.filename}
                </p>
                <p className="text-xs uppercase text-muted-foreground">{image.imageType ?? 'webp'}</p>
              </td>
              <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground" title={image.altText ?? ''}>
                {image.altText || '—'}
              </td>
              <td className="px-4 py-3 tabular-nums text-muted-foreground">{image.sortOrder ?? 0}</td>
              <td className="px-4 py-3">
                {image.isPrimary ? <Badge tone="info">Primary</Badge> : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="px-4 py-3 text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(image)}
                    aria-label={`Edit metadata for ${image.filename}`}
                    title={`Edit metadata for ${image.filename}`}
                    className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground hover:no-underline"
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(image)}
                    aria-label={`Delete ${image.filename}`}
                    title={`Delete ${image.filename}`}
                    className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive hover:no-underline"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {uploadOpen ? (
        <Modal title="Upload image" onClose={() => !mutating && setUploadOpen(false)} persistent={mutating}>
          <UploadForm
            key={uploadKey}
            productId={productId}
            variants={variants}
            submitting={mutating}
            setSubmitting={setMutating}
            onCancel={() => setUploadOpen(false)}
            onDone={({ close }) => {
              // Gallery always refreshes (successful uploads must appear);
              // the modal stays open on partial failure so errors remain
              // visible next to the files that caused them.
              refresh();
              if (close) setUploadOpen(false);
            }}
          />
        </Modal>
      ) : null}

      {editing ? (
        <Modal title={`Edit “${editing.filename}”`} onClose={() => !mutating && setEditing(null)} persistent={mutating}>
          <MetadataForm
            key={editing.id}
            initialValue={editing}
            variants={variants}
            submitting={mutating}
            onCancel={() => setEditing(null)}
            onSubmit={handleMetadataSave}
          />
        </Modal>
      ) : null}

      {previewing ? (
        <Modal title={previewing.filename} onClose={() => setPreviewing(null)}>
          <div className="flex flex-col gap-3">
            <PreviewImage key={previewing.id} image={previewing} />
            <dl className="flex flex-col gap-1 text-xs text-muted-foreground">
              {previewing.altText ? (
                <div className="flex gap-2">
                  <dt className="font-semibold text-foreground">Alt text</dt>
                  <dd>{previewing.altText}</dd>
                </div>
              ) : null}
              <div className="flex gap-2">
                <dt className="font-semibold text-foreground">Order</dt>
                <dd>
                  {previewing.sortOrder ?? 0}
                  {previewing.isPrimary ? ' · Primary' : ''}
                </dd>
              </div>
            </dl>
          </div>
        </Modal>
      ) : null}

      {deleting ? (
        <Modal
          title={`Delete “${deleting.filename}”?`}
          onClose={() => !mutating && setDeleting(null)}
          persistent={mutating}
        >
          <p className="text-sm leading-6 text-muted-foreground">
            This permanently deletes the image file and its record. Storefront
            listings fall back to the placeholder. This cannot be undone.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={mutating}>
              Keep image
            </Button>
            <Button variant="destructive" loading={mutating} onClick={handleDelete}>
              Yes, delete
            </Button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
