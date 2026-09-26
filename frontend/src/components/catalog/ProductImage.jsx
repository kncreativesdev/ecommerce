import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { fetchProductImages, resolveImageUrl } from '../../services/media.service.js';
import { displayImageForVariant, primaryImageFor } from '../../utils/variantMedia.js';
import { env } from '../../config/env.js';
import { cn } from '../../lib/cn.js';

// Module-level metadata cache: one `GET /products/:id/images` per product
// per session, shared across every card/gallery instance.
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

function pickPrimary(images) {
  return primaryImageFor(images);
}

/**
 * Product image renderer — the ONLY component that turns image metadata
 * into pixels. URL = `{VITE_MEDIA_BASE_URL}{storagePath}` with a neutral
 * placeholder fallback on missing metadata or load failure (GAP-07: no
 * static serving route is documented and the seed has no media, so the
 * placeholder is the honest default, not an error).
 *
 * `variantId` scopes the pick to that variant's gallery (primary first),
 * falling back to the product-level images — so cards, cart lines, and
 * galleries for Variant A never render Variant B's images. One cached
 * `GET /products/:id/images` per product per session, shared across every
 * instance; no extra requests per variant.
 *
 * Presentation defaults to uncropped `object-contain` (preserves uploaded
 * proportions; `bg-surface-muted` fills the letterbox area). Callers may
 * override via `imgClassName` — the product card intentionally opts into
 * `object-cover` as a card-presentation decision (resolved last via
 * tailwind-merge, so it wins over the default).
 */
export function ProductImage({ productId, variantId = null, alt, className, imgClassName, eager = false }) {
  const [loaded, setLoaded] = useState({ productId, variantId, url: null });
  const [failedUrl, setFailedUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadImages(productId).then((images) => {
      if (cancelled) return;
      const primary = variantId ? displayImageForVariant(images, variantId) : pickPrimary(images);
      setLoaded({ productId, variantId, url: resolveImageUrl(primary, env.mediaBaseUrl) });
    });
    return () => {
      cancelled = true;
    };
  }, [productId, variantId]);

  const current = loaded.productId === productId && loaded.variantId === variantId ? loaded.url : null;
  if (!current || current === failedUrl) {
    return (
      <span
        aria-hidden="true"
        className={cn('inline-flex h-full w-full items-center justify-center bg-surface-muted text-muted-foreground', className)}
      >
        <ImageIcon size={40} strokeWidth={1.5} />
      </span>
    );
  }

  return (
    <img
      src={current}
      alt={alt || 'Product image'}
      loading={eager ? 'eager' : 'lazy'}
      onError={() => setFailedUrl(current)}
      className={cn('h-full w-full bg-surface-muted object-contain', imgClassName, className)}
    />
  );
}
