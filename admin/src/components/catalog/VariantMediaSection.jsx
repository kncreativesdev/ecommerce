import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, ImagePlus, Star, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { ErrorState } from '../ui/ErrorState.jsx';
import { Modal } from '../ui/Modal.jsx';
import {
  deleteProductImage,
  fetchProductImages,
  resolveImageUrl,
  updateImageMetadata,
  uploadProductImage,
} from '../../services/media.service.js';
import { mediaUploadErrorMessage, validateChosenFile } from '../../utils/imageSelection.js';
import { cn } from '../../lib/cn.js';

/**
 * Per-variant media galleries for the product edit page. ONE
 * `GET /products/:id/images` fetch per product; rows are partitioned
 * client-side by `variantId` (the backend returns every image with its
 * scope already ordered). Each variant card shows its own images, count,
 * upload (preset `variantId` — same `uploadProductImage` service the
 * product gallery uses), primary toggle, sort-order edit, and delete.
 *
 * Variant lifecycle (activate/deactivate) stays in `VariantManager` above;
 * deactivation never touches media (backend nulls nothing on variant
 * deactivation — only variant DELETION nulls `variantId`, and there is no
 * variant hard-delete endpoint). Product-level images (`variantId: null`)
 * are managed in `MediaManager`, not here.
 *
 * Edit compatibility: legacy variants with zero images are NOT blocked —
 * the empty state names the gap explicitly and activation stays available
 * (retroactive validation would lock legitimate legacy rows). New products
 * enforce ≥1 image per variant at creation instead. Imageless variants
 * fall back to the product-level gallery on the storefront and never show
 * another variant's images.
 */
export function VariantMediaSection({ productId, variants = [] }) {
  const [images, setImages] = useState(null);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [uploadingId, setUploadingId] = useState(null);
  const [deleting, setDeleting] = useState(null); // image | null
  const [mutating, setMutating] = useState(false);
  const [primaryId, setPrimaryId] = useState(null);
  const [sortEdits, setSortEdits] = useState({});
  const [sortPendingId, setSortPendingId] = useState(null);
  const [prevKey, setPrevKey] = useState(null);
  const fileInputsRef = useRef({});

  // Render-time reset when the product (or an explicit refresh) changes —
  // the sanctioned derived-state pattern; the effect below only syncs the
  // async fetch, never state synchronously.
  const fetchKey = `${productId ?? ''}:${reloadToken}`;
  if (prevKey !== fetchKey) {
    setPrevKey(fetchKey);
    setImages(productId ? null : []);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    if (!productId) {
      return undefined;
    }
    fetchProductImages(productId)
      .then((list) => {
        if (cancelled) return;
        setImages(Array.isArray(list) ? list : []);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setError(fetchError?.message ?? 'Failed to load variant images.');
        setImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, reloadToken]);

  const refresh = () => setReloadToken((token) => token + 1);

  const imagesForVariant = (variantId) =>
    (images ?? [])
      .filter((image) => image?.variantId === variantId)
      .sort((a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0));

  const handleFiles = async (variant, fileList) => {
    const picked = Array.from(fileList ?? []);
    const input = fileInputsRef.current[variant.id];
    if (input) input.value = '';
    const valid = [];
    for (const file of picked) {
      const rejection = validateChosenFile(file);
      if (rejection) {
        toast.error(`${file?.name ?? 'File'}: ${rejection}`);
      } else {
        valid.push(file);
      }
    }
    if (valid.length === 0 || !productId) return;
    setUploadingId(variant.id);
    let uploaded = 0;
    const failures = [];
    for (const file of valid) {
      try {
        await uploadProductImage(productId, { file, variantId: variant.id });
        uploaded += 1;
      } catch (uploadError) {
        failures.push(`${file?.name ?? 'image'}: ${mediaUploadErrorMessage(uploadError)}`);
      }
    }
    setUploadingId(null);
    if (uploaded > 0) {
      toast.success(`${uploaded} ${uploaded === 1 ? 'image' : 'images'} added to variant “${variant.sku}”.`);
    }
    if (failures.length > 0) {
      toast.error(`Some uploads failed — kept the successful ones. ${failures.join(' ')}`);
    }
    refresh();
  };

  const handleDelete = async () => {
    if (!productId || !deleting?.id) return;
    setMutating(true);
    try {
      await deleteProductImage(productId, deleting.id);
      toast.success('Image deleted.');
      setDeleting(null);
      refresh();
    } catch (deleteError) {
      toast.error(deleteError?.message ?? 'Delete failed. Please try again.');
    } finally {
      setMutating(false);
    }
  };

  const handlePrimary = async (image) => {
    if (!productId || !image?.id || primaryId) return;
    setPrimaryId(image.id);
    try {
      await updateImageMetadata(productId, image.id, { isPrimary: !image.isPrimary });
      toast.success(image.isPrimary ? 'Primary flag removed.' : 'Marked as primary image.');
      refresh();
    } catch (primaryError) {
      toast.error(primaryError?.message ?? 'Update failed. Please try again.');
    } finally {
      setPrimaryId(null);
    }
  };

  const handleSortSave = async (image) => {
    const raw = (sortEdits[image.id] ?? '').trim();
    if (raw === '' || !productId || sortPendingId) return;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      toast.error('Sort order must be a whole number ≥ 0.');
      return;
    }
    setSortPendingId(image.id);
    try {
      await updateImageMetadata(productId, image.id, { sortOrder: value });
      toast.success('Sort order saved.');
      setSortEdits((previous) => {
        const next = { ...previous };
        delete next[image.id];
        return next;
      });
      refresh();
    } catch (sortError) {
      toast.error(sortError?.message ?? 'Update failed. Please try again.');
    } finally {
      setSortPendingId(null);
    }
  };

  if (!Array.isArray(variants) || variants.length === 0) {
    return null;
  }

  return (
    <section aria-label="Variant images" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Variant images</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Each variant owns its gallery — images never mix between variants. Product-level images live in Media below.
        </p>
      </div>

      {images === null ? (
        <div role="status" aria-label="Loading variant images" className="flex flex-col gap-2">
          {[0, 1].map((index) => (
            <div key={index} aria-hidden="true" className="h-24 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load variant images" message={error} onRetry={refresh} />
      ) : (
        <ul className="flex flex-col gap-3">
          {variants.map((variant) => {
            const gallery = imagesForVariant(variant.id);
            const uploading = uploadingId === variant.id;
            return (
              <li
                key={variant.id}
                aria-label={`Images for variant ${variant.sku}`}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-bold text-foreground">{variant.name}</p>
                    <span className="font-mono text-xs text-muted-foreground">{variant.sku}</span>
                    <Badge tone={variant.isActive === false ? 'neutral' : 'success'}>
                      {variant.isActive === false ? 'Inactive' : 'Active'}
                    </Badge>
                    <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
                      {gallery.length} {gallery.length === 1 ? 'image' : 'images'}
                    </span>
                  </div>
                  <label
                    className={cn(
                      'inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-surface-muted',
                      uploading && 'cursor-wait opacity-60',
                    )}
                  >
                    <ImagePlus size={15} aria-hidden="true" />
                    {uploading ? 'Uploading…' : 'Add image'}
                    <input
                      ref={(node) => {
                        if (node) fileInputsRef.current[variant.id] = node;
                      }}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      disabled={uploading}
                      onChange={(event) => handleFiles(variant, event.target.files)}
                      aria-label={`Add images to variant ${variant.sku}`}
                      className="sr-only"
                    />
                  </label>
                </div>

                {gallery.length === 0 ? (
                  <EmptyState
                    icon={ImageIcon}
                    title="No images for this variant"
                    message="Add images above, or leave empty to fall back to the product-level gallery on the storefront."
                  />
                ) : (
                  <ul aria-label={`Gallery of variant ${variant.sku}`} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {gallery.map((image) => {
                      const url = resolveImageUrl(image);
                      return (
                        <li key={image.id} className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2">
                          {url ? (
                            <img src={url} alt={image.altText || variant.name} loading="lazy" className="aspect-square w-full rounded-md border border-border object-cover" />
                          ) : (
                            <span aria-hidden="true" className="inline-flex aspect-square w-full items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
                              <ImageIcon size={22} />
                            </span>
                          )}
                          <span className="truncate font-mono text-[11px] text-muted-foreground">{image.filename}</span>
                          <span className="flex flex-wrap items-center gap-1">
                            {image.isPrimary ? (
                              <Badge tone="info">Primary</Badge>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handlePrimary(image)}
                                disabled={primaryId === image.id}
                                aria-label={`Mark image as primary for variant ${variant.sku}`}
                                title="Mark as primary"
                                className="inline-flex h-9 min-w-9 cursor-pointer items-center justify-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                              >
                                <Star size={14} aria-hidden="true" />
                                Primary
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setDeleting(image)}
                              aria-label={`Delete image ${image.filename}`}
                              title="Delete image"
                              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <label htmlFor={`sort-${image.id}`} className="sr-only">
                              Sort order for image {image.filename}
                            </label>
                            <input
                              id={`sort-${image.id}`}
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              placeholder={String(image.sortOrder ?? 0)}
                              value={sortEdits[image.id] ?? ''}
                              onChange={(event) => setSortEdits((previous) => ({ ...previous, [image.id]: event.target.value }))}
                              className="min-h-[36px] w-16 rounded-md border border-input bg-surface px-2 text-xs tabular-nums text-foreground focus:border-ring focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleSortSave(image)}
                              disabled={sortPendingId === image.id || (sortEdits[image.id] ?? '').trim() === ''}
                              className="inline-flex min-h-[36px] cursor-pointer items-center rounded-md px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {sortPendingId === image.id ? 'Saving…' : 'Save'}
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {deleting ? (
        <Modal title="Delete this image?" onClose={() => !mutating && setDeleting(null)} persistent={mutating}>
          <p className="text-sm leading-6 text-muted-foreground">
            <span className="font-mono">{deleting.filename}</span> will be removed permanently (file + record).
            Other variants and the product gallery are unaffected.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={mutating}>
              Keep image
            </Button>
            <Button variant="destructive" loading={mutating} onClick={handleDelete}>
              <X size={15} aria-hidden="true" />
              Yes, delete
            </Button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
