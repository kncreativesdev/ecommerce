import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { fetchProductImages, resolveImageUrl } from '../../services/media.service.js';
import { galleryForVariant } from '../../utils/variantMedia.js';
import { env } from '../../config/env.js';
import { cn } from '../../lib/cn.js';

/**
 * Product detail gallery: main image + thumbnail strip.
 *
 * Data comes only from `GET /products/:productId/images` (one request per
 * product; sorted by `sortOrder`). When `variantId` selects a variant WITH
 * images, exactly that variant's gallery shows; otherwise the
 * product-level images are the fallback (a variant never shows another
 * variant's images). Gallery selection resets whenever the product OR the
 * selected variant changes. URLs resolve via `VITE_MEDIA_BASE_URL` +
 * `storagePath`; anything missing or failed falls back to a neutral,
 * intentional placeholder — never an external URL, never a broken image.
 * Thumbnails render only when multiple usable images exist. Fixed aspect
 * wells avoid layout shift; native buttons keep full keyboard support.
 */
export function ProductGallery({ productId, productName, variantId = null }) {
  const [images, setImages] = useState(null);
  const [selected, setSelected] = useState(0);
  const [failedUrls, setFailedUrls] = useState({});
  const [prevProductId, setPrevProductId] = useState(productId);
  const [prevVariantId, setPrevVariantId] = useState(variantId);

  // Reset gallery state when the product or the selected variant changes
  // (render-time adjustment — the sanctioned derived-state pattern used
  // across the codebase).
  if (prevProductId !== productId || prevVariantId !== variantId) {
    setPrevProductId(productId);
    setPrevVariantId(variantId);
    setSelected(0);
    setFailedUrls({});
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

  const markFailed = (url) => {
    if (!url) return;
    setFailedUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-border bg-surface-muted">
        {images === null ? (
          <div role="status" aria-label="Loading product images" className="tp-shimmer h-full w-full" />
        ) : current ? (
          <img
            key={current.url}
            src={current.url}
            alt={current.image?.altText || productName || 'Product image'}
            loading="eager"
            onError={() => markFailed(current.url)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="inline-flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageIcon size={44} strokeWidth={1.5} aria-hidden="true" />
            <span className="px-4 text-center text-xs">Product image coming soon</span>
          </span>
        )}
      </div>

      {usable.length > 1 ? (
        <ul aria-label="Product images" className="flex gap-2 overflow-x-auto pb-1">
          {usable.map((entry, index) => {
            const isActive = index === activeIndex;
            return (
              <li key={entry.image?.id ?? entry.url} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setSelected(index)}
                  aria-label={`View image ${index + 1} of ${usable.length}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'block h-20 w-20 cursor-pointer overflow-hidden rounded-xl border bg-surface-muted transition-colors duration-200',
                    isActive
                      ? 'border-transparent ring-2 ring-ring ring-offset-2 ring-offset-background'
                      : 'border-border hover:border-border-strong',
                  )}
                >
                  <img
                    src={entry.url}
                    alt=""
                    loading="lazy"
                    onError={() => markFailed(entry.url)}
                    className="h-full w-full object-cover"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
