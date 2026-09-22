import { useState } from 'react';
import { resolveCategoryImageUrl } from '../../../services/media.service.js';
import { env } from '../../../config/env.js';
import { cn } from '../../../lib/cn.js';

/**
 * Small subcategory thumbnail: renders the uploaded `subcategory.image`
 * (resolved via `VITE_MEDIA_BASE_URL` — the backend stores a relative
 * `categories/<id>/<uuid>.webp` reference, never an absolute URL) when a
 * real reference exists AND loads, otherwise the polished neutral tile
 * with the configured Lucide icon. Never renders a broken image — load
 * failure flips to the icon fallback, and populating `image` later
 * requires no component change.
 */
export function SubcategoryThumb({ subcategory, size = 'md', className }) {
  const [failed, setFailed] = useState(false);
  const Icon = subcategory.icon;
  const box =
    size === 'sm'
      ? 'h-9 w-9 rounded-lg [&_svg]:size-4'
      : 'h-12 w-12 rounded-xl [&_svg]:size-5';
  const url = failed
    ? null
    : resolveCategoryImageUrl(subcategory.image, env.mediaBaseUrl);

  if (url) {
    return (
      <img
        src={url}
        alt={subcategory.name}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn(box, 'shrink-0 bg-surface-muted object-cover', className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        box,
        'inline-flex shrink-0 items-center justify-center bg-surface-muted text-muted-foreground',
        'transition-colors duration-200 group-hover:bg-accent group-hover:text-accent-foreground',
        className,
      )}
    >
      {Icon ? <Icon strokeWidth={2} /> : null}
    </span>
  );
}
