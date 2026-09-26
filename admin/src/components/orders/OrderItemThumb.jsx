import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { resolveImageUrl } from '../../services/media.service.js';
import { cn } from '../../lib/cn.js';

/**
 * Historical purchased-variant thumbnail from the immutable order snapshot
 * (`imageStoragePath`). Pre-snapshot orders carry null and render the
 * neutral placeholder — live variant media is never consulted for history,
 * so replaced/deactivated media cannot rewrite old orders.
 * `object-contain` shows the full snapshot without cropping.
 */
export function OrderItemThumb({ imageStoragePath, label = 'Order item image', size = 'h-10 w-10', className }) {
  const [failed, setFailed] = useState(false);
  const url = failed
    ? null
    : resolveImageUrl(imageStoragePath ? { storagePath: imageStoragePath } : null);
  if (!url) {
    return (
      <span
        aria-label={`No image snapshot for ${label}`}
        title="No image snapshot for this item"
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground',
          size,
          className,
        )}
      >
        <ImageIcon size={18} aria-hidden="true" />
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
      className={cn('shrink-0 rounded-lg border border-border bg-surface-muted object-contain', size, className)}
    />
  );
}
