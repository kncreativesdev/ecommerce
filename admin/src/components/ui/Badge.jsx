import { cn } from '../../lib/cn.js';

const toneClasses = {
  neutral: 'bg-surface-muted text-muted-foreground',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/15 text-destructive',
  info: 'bg-accent/15 text-accent',
};

/** Small status pill. Icon + text pairing is the caller's job (never color-only). */
export function Badge({ tone = 'neutral', className, children, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        toneClasses[tone] ?? toneClasses.neutral,
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
