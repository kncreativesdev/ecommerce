import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { fetchProductImages, resolveImageUrl } from '../../services/media.service.js';
import { pickDefaultVariantImage } from '../../utils/productMedia.js';
import { cn } from '../../lib/cn.js';

// Session cache: one `GET /products/:id/images` per product, shared across
// every row (the product list endpoint embeds no images).
const imageCache = new Map();

function loadImages(productId) {
  if (!productId) return Promise.resolve([]);
  if (!imageCache.has(productId)) {
    imageCache.set(
      productId,
      fetchProductImages(productId)
        .then((images) => (Array.isArray(images) ? images : []))
        .catch(() => []),
    );
  }
  return imageCache.get(productId);
}

/**
 * Compact main/default product thumbnail for dense admin rows.
 *
 * Uses the established default-variant image rule (same priority as the
 * storefront card) over `GET /products/:id/images` — no new API, no new
 * selection algorithm. Fixed small square subordinate to the product name;
 * `object-contain` never crops; missing/broken images fall back to the
 * neutral tile.
 */
export function ProductThumb({ product, className }) {
  const productId = product?.id ?? null;
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [prevProductId, setPrevProductId] = useState(productId);
  if (prevProductId !== productId) {
    setPrevProductId(productId);
    setUrl(null);
    setFailed(false);
  }

  useEffect(() => {
    let cancelled = false;
    if (!productId) return undefined;
    loadImages(productId).then((images) => {
      if (cancelled) return;
      const picked = pickDefaultVariantImage(images, product);
      setUrl(resolveImageUrl(picked));
    });
    return () => {
      cancelled = true;
    };
    // Product identity change handled render-time above; images resolve once
    // per product id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  if (!url || failed) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-muted-foreground',
          className,
        )}
      >
        <ImageIcon size={18} />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('h-10 w-10 shrink-0 rounded-lg border border-border bg-surface-muted object-contain', className)}
    />
  );
}
