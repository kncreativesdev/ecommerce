import { useState } from 'react';
import { Tags } from 'lucide-react';
import { resolveCategoryImageUrl } from '../../services/media.service.js';
import { cn } from '../../lib/cn.js';

/**
 * Compact category thumbnail for dense admin rows.
 *
 * - Backend `category.image` reference resolved via the centralized
 *   `resolveCategoryImageUrl` (same mechanism as the category form preview).
 * - Missing/broken image → neutral tile with the Tags motif (matches the
 *   category management empty state) instead of a broken-image frame.
 * - Fixed small square that never grows the row; `object-contain` shows the
 *   full image without cropping.
 */
export function CategoryThumb({ image, className }) {
  const [failed, setFailed] = useState(false);
  const url = failed ? null : resolveCategoryImageUrl(image);
  const box = cn(
    'inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-muted',
    className,
  );
  if (!url) {
    return (
      <span aria-hidden="true" className={cn(box, 'text-muted-foreground')}>
        <Tags size={18} />
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
      className="h-10 w-10 shrink-0 rounded-lg border border-border bg-surface-muted object-contain"
    />
  );
}
