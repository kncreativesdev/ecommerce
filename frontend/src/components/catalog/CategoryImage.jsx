import { useState } from 'react';
import { resolveCategoryImageUrl } from '../../services/media.service.js';
import { env } from '../../config/env.js';
import { cn } from '../../lib/cn.js';

/**
 * Category/subcategory thumbnail with Lucide-icon fallback.
 *
 * Rule (single place, used by every category discovery surface):
 * - IF the record carries a usable uploaded `image` reference AND it loads
 *   → render the `<img>` (resolved via `VITE_MEDIA_BASE_URL`).
 * - ELSE → render the existing Lucide icon tile (decorative fallback).
 *
 * The icon is never wrong on its own — it is only wrong when a real image
 * exists and is ignored. Load failures flip to the fallback instead of a
 * broken-image frame. Fixed box dimensions + `object-cover` keep a stable
 * aspect ratio (no layout shift); images lazy-load by default.
 */
export function CategoryImage({
  image,
  name,
  icon: Icon,
  className,
  imgClassName,
  eager = false,
}) {
  const [failed, setFailed] = useState(false);
  const url = failed ? null : resolveCategoryImageUrl(image, env.mediaBaseUrl);

  if (!url) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 items-center justify-center bg-surface-muted text-muted-foreground',
          className,
        )}
      >
        {Icon ? <Icon aria-hidden="true" /> : null}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={name ?? 'Category image'}
      loading={eager ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
      className={cn('shrink-0 bg-surface-muted object-cover', className, imgClassName)}
    />
  );
}
