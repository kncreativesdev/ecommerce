import { cn } from '../../lib/cn.js';

/**
 * Shimmer block matching surrounding anatomy (both themes via
 * `surface-muted`). Callers compose exact shapes; `className` sets size.
 */
export function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn('tp-shimmer rounded-lg bg-surface-muted', className)} />;
}
