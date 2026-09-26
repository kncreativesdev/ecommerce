import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

/**
 * Full-screen PRODUCT PHOTO viewer (photos only — never product
 * information, pricing, variant, or cart controls).
 *
 * - `images`: complete usable gallery `[{ url, alt }]` (not just visible
 *   thumbnails); navigation cycles through all of them.
 * - `index`: currently displayed image; `onNavigate(next)` requests moves.
 * - Dark backdrop, `object-contain` uncropped photo, prev/next + close
 *   controls, `aria-live` position, Escape/backdrop close, body scroll
 *   lock, and focus restore on unmount. No new dependencies — Tailwind +
 *   Lucide primitives already in the project.
 */
export function ProductLightbox({ images = [], index = 0, productName, onNavigate, onClose }) {
  const closeRef = useRef(null);
  const count = images.length;
  const safeIndex = count > 0 ? ((index % count) + count) % count : 0;
  const current = count > 0 ? images[safeIndex] : null;

  // Escape closes; body scroll locks while open; focus lands on Close and
  // returns to the opener when the viewer unmounts.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  if (!current) return null;

  const goTo = (next) => {
    if (count <= 1) return;
    onNavigate?.(((next % count) + count) % count);
  };

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget) onClose?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={productName ? `${productName} image viewer` : 'Product image viewer'}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4 sm:p-8"
    >
      <div className="flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm font-semibold tabular-nums text-white/80">
          {count > 1 ? `Image ${safeIndex + 1} of ${count}` : 'Image'}
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={() => onClose?.()}
          aria-label="Close image viewer"
          className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors duration-200 hover:bg-white/20"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center py-4">
        {count > 1 ? (
          <button
            type="button"
            onClick={() => goTo(safeIndex - 1)}
            aria-label="Previous product image"
            className="absolute left-0 z-10 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors duration-200 hover:bg-white/20 sm:left-4"
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
        ) : null}
        <img
          key={current.url}
          src={current.url}
          alt={current.alt || productName || 'Product image'}
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden';
          }}
          className="max-h-full max-w-full object-contain"
        />
        {count > 1 ? (
          <button
            type="button"
            onClick={() => goTo(safeIndex + 1)}
            aria-label="Next product image"
            className="absolute right-0 z-10 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors duration-200 hover:bg-white/20 sm:right-4"
          >
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
