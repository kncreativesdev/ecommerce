import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { fetchProductImages, resolveImageUrl } from '../../services/media.service.js';
import { galleryForVariant } from '../../utils/variantMedia.js';
import { env } from '../../config/env.js';
import { cn } from '../../lib/cn.js';
import { ProductLightbox } from './ProductLightbox.jsx';

/**
 * Product detail gallery: main image + thumbnails + full-screen viewer.
 *
 * Data comes only from `GET /products/:productId/images` (one request per
 * product; sorted by `sortOrder`). When `variantId` selects a variant WITH
 * images, exactly that variant's gallery shows; otherwise the
 * product-level images are the fallback (a variant never shows another
 * variant's images). Gallery selection resets whenever the product OR the
 * selected variant changes. URLs resolve via `VITE_MEDIA_BASE_URL` +
 * `storagePath`; anything missing or failed falls back to a neutral,
 * intentional placeholder — never an external URL, never a broken image.
 *
 * Layout: narrow portrait `aspect-[4/5]` main well (`object-contain`, never
 * cropped) capped on large screens so its height stays close to the
 * previous gallery height. One thumbnail list serves both breakpoints —
 * a LEFT column on `sm`+ screens, a horizontal strip BELOW the main image
 * on mobile (`flex-col-reverse`). At most `MAX_VISIBLE_THUMBS` tiles show;
 * the rest collapse into an interactive `+N` tile that opens the viewer at
 * the first hidden image. Cyclic prev/next arrows flank the main image.
 * Clicking the main image opens the photo-only full-screen viewer over the
 * COMPLETE usable list (never just the visible tiles). Native buttons keep
 * full keyboard support; thumbnail buttons reserve inner padding so the
 * selected ring never clips the image.
 */
const MAX_VISIBLE_THUMBS = 3;

export function ProductGallery({ productId, productName, variantId = null }) {
  const [images, setImages] = useState(null);
  const [selected, setSelected] = useState(0);
  const [failedUrls, setFailedUrls] = useState({});
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [prevProductId, setPrevProductId] = useState(productId);
  const [prevVariantId, setPrevVariantId] = useState(variantId);

  // Reset gallery state when the product or the selected variant changes
  // (render-time adjustment — the sanctioned derived-state pattern used
  // across the codebase). An open viewer never survives a variant switch,
  // so it can never show stale images from another variant.
  if (prevProductId !== productId || prevVariantId !== variantId) {
    setPrevProductId(productId);
    setPrevVariantId(variantId);
    setSelected(0);
    setFailedUrls({});
    setLightboxIndex(null);
    if (prevProductId !== productId) {
      setImages(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchProductImages(productId)
      .then((list) => {
        if (cancelled) return;
        const sorted = [...(Array.isArray(list) ? list : [])].sort(
          (a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0),
        );
        setImages(sorted);
      })
      .catch(() => {
        if (!cancelled) setImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const scoped = galleryForVariant(images, variantId);
  const usable = scoped
    .map((image) => ({ image, url: resolveImageUrl(image, env.mediaBaseUrl) }))
    .filter((entry) => entry.url && !failedUrls[entry.url]);
  const activeIndex = usable.length > 0 ? Math.min(selected, usable.length - 1) : 0;
  const current = usable.length > 0 ? usable[activeIndex] : null;

  // Deterministic overflow: first tiles in gallery order stay visible; the
  // remainder collapse into one interactive +N tile (never faked — derived
  // from the real usable list).
  const visibleThumbs = usable.slice(0, MAX_VISIBLE_THUMBS);
  const hiddenCount = usable.length - visibleThumbs.length;
  // The thumbnail column ALWAYS renders when at least one usable image
  // exists — including the single-image case. Gating it on `length > 1`
  // let the main well expand to full width for one image, changing its
  // rendered dimensions. One image simply appears in both presentations
  // (main + selected thumbnail); this is normal gallery UI, not media
  // duplication — `usable` still holds exactly the real gallery images.
  const showThumbs = usable.length > 0;

  const markFailed = (url) => {
    if (!url) return;
    setFailedUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  const goTo = (next) => {
    if (usable.length <= 1) return;
    setSelected(((next % usable.length) + usable.length) % usable.length);
  };

  const thumbButtonClass = (isActive) =>
    cn(
      'block h-20 w-20 cursor-pointer overflow-hidden rounded-xl border bg-surface-muted p-1.5 transition-colors duration-200',
      isActive
        ? 'border-transparent ring-2 ring-ring ring-offset-2 ring-offset-background'
        : 'border-border hover:border-border-strong',
    );

  return (
    <div className="mx-auto flex w-full flex-col-reverse gap-3 sm:flex-row sm:items-start sm:max-w-[520px]">
      {showThumbs ? (
        <ul
          aria-label="Product images"
          className="flex shrink-0 gap-3 overflow-x-auto p-1 sm:w-[92px] sm:flex-col sm:overflow-x-visible"
        >
          {visibleThumbs.map((entry, index) => {
            const isActive = index === activeIndex;
            return (
              <li key={entry.image?.id ?? entry.url} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setSelected(index)}
                  aria-label={`View image ${index + 1} of ${usable.length}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={thumbButtonClass(isActive)}
                >
                  <img
                    src={entry.url}
                    alt=""
                    loading="lazy"
                    onError={() => markFailed(entry.url)}
                    className="h-full w-full rounded-lg object-contain"
                  />
                </button>
              </li>
            );
          })}
          {hiddenCount > 0 ? (
            <li className="shrink-0">
              <button
                type="button"
                onClick={() => setLightboxIndex(visibleThumbs.length)}
                aria-label={`View ${hiddenCount} more images`}
                className={cn(thumbButtonClass(false), 'flex items-center justify-center')}
              >
                <span aria-hidden="true" className="text-base font-extrabold tabular-nums text-foreground">
                  +{hiddenCount}
                </span>
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="relative aspect-[4/5] w-full flex-1 overflow-hidden rounded-2xl border border-border bg-surface-muted">
        {images === null ? (
          <div role="status" aria-label="Loading product images" className="tp-shimmer h-full w-full" />
        ) : current ? (
          <>
            <button
              type="button"
              onClick={() => setLightboxIndex(activeIndex)}
              aria-label="Open full-screen image viewer"
              className="absolute inset-0 h-full w-full cursor-zoom-in"
            >
              <img
                key={current.url}
                src={current.url}
                alt={current.image?.altText || productName || 'Product image'}
                loading="eager"
                onError={() => markFailed(current.url)}
                className="h-full w-full object-contain"
              />
            </button>
            {usable.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => goTo(activeIndex - 1)}
                  aria-label="Previous product image"
                  className="absolute left-3 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition-colors duration-200 hover:border-accent hover:text-white"
                >
                  <ChevronLeft size={20} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => goTo(activeIndex + 1)}
                  aria-label="Next product image"
                  className="absolute right-3 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition-colors duration-200 hover:border-accent hover:text-white"
                >
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
              </>
            ) : null}
          </>
        ) : (
          <span className="inline-flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageIcon size={44} strokeWidth={1.5} aria-hidden="true" />
            <span className="px-4 text-center text-xs">Product image coming soon</span>
          </span>
        )}
      </div>

      {lightboxIndex !== null && usable.length > 0 ? (
        <ProductLightbox
          images={usable.map((entry) => ({ url: entry.url, alt: entry.image?.altText }))}
          index={Math.min(lightboxIndex, usable.length - 1)}
          productName={productName}
          onNavigate={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </div>
  );
}
