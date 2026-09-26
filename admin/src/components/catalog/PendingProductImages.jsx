import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { Field } from '../ui/Field.jsx';
import { nextPendingImageId, validateChosenFile } from '../../utils/imageSelection.js';

/**
 * Pre-create image selector (used by the product create form — no product
 * ID exists yet, so nothing uploads from here). Selection, per-file
 * validation, local previews, and removal live in this component; the
 * VALID files are reported upward via `onSelectionChange` for the caller
 * to upload AFTER the product exists (same `uploadProductImage` service
 * the edit gallery uses — one media architecture).
 *
 * Previews are local object URLs only: revoked on remove/replace/unmount,
 * never persisted, never stored in Zustand, never sent anywhere except as
 * `File` objects to the real multipart endpoint by the caller.
 */
export function PendingProductImages({ onSelectionChange, disabled = false, title = 'Product images (optional)', hint = 'JPEG, PNG, or WebP · max 5 MB each · up to 8000px per side (checked by the server). Files upload after the product is created.' }) {
  // Entries: [{ id, file, name, url|null, error|null }]. Invalid files are
  // shown with their reason and never reported upward.
  const [entries, setEntries] = useState([]);
  const urlsRef = useRef(new Map());

  useEffect(
    () => () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    onSelectionChange(entries.filter((entry) => !entry.error).map((entry) => entry.file));
  }, [entries, onSelectionChange]);

  const handleFilesChange = (event) => {
    const picked = Array.from(event.target.files ?? []);
    // Reset the input so the same files can be re-chosen after removal.
    event.target.value = '';
    if (picked.length === 0 || disabled) return;
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current.clear();
    setEntries(
      picked.map((file) => {
        const error = validateChosenFile(file);
        const id = nextPendingImageId();
        let url = null;
        if (!error) {
          url = URL.createObjectURL(file);
          urlsRef.current.set(id, url);
        }
        return { id, file, name: file.name, url, error };
      }),
    );
  };

  const removeEntry = (id) => {
    if (disabled) return;
    const url = urlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(id);
    }
    setEntries((previous) => previous.filter((entry) => entry.id !== id));
  };

  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">{title}</h3>
      <Field
        label="Image files"
        hint={hint}
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={disabled}
          onChange={handleFilesChange}
          aria-label="Select product images"
          className="min-h-[44px] w-full cursor-pointer rounded-lg border border-input bg-surface px-3.5 py-2.5 text-sm text-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-foreground hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-60"
        />
      </Field>
      {entries.length > 0 ? (
        <ul aria-label="Selected product images" className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted/50 p-2.5"
            >
              {entry.url ? (
                <img src={entry.url} alt={`Preview of ${entry.name}`} className="h-12 w-12 shrink-0 rounded-md border border-border bg-surface-muted object-contain" />
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
                  <span className="text-xs text-muted-foreground">Ready — uploads after product creation</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => removeEntry(entry.id)}
                disabled={disabled}
                aria-label={`Remove ${entry.name}`}
                className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
