import { forwardRef } from 'react';
import { cn } from '../../../lib/cn.js';

/**
 * Shared icon-button grammar for the dark header chrome. White icon on the
 * fixed-dark navbar in both themes, red hover accent, visible focus ring.
 * Renders as a `Link`-compatible button OR wraps an anchor via `asChild`-style
 * composition — here kept simple: pass through all props to `<button>`.
 */
export const HeaderIconButton = forwardRef(function HeaderIconButton(
  { className, label, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg',
        'text-header-foreground transition-colors duration-200',
        'hover:bg-header-foreground/10 hover:text-accent',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
