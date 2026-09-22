import { cn } from '../../lib/cn.js';

const variantClasses = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-border bg-surface text-secondary-foreground hover:bg-surface-muted',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
  ghost: 'text-foreground hover:bg-surface-muted',
};

const sizeClasses = {
  sm: 'min-h-[36px] px-3 text-[13px]',
  md: 'min-h-[44px] px-4 text-sm',
};

/**
 * Admin button. Token-driven variants; loading state replaces the label
 * with a spinner and disables the control (double-submit guard).
 */
export function Button({ variant = 'primary', size = 'md', loading = false, className, children, disabled, ...props }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant] ?? variantClasses.primary,
        sizeClasses[size] ?? sizeClasses.md,
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}
