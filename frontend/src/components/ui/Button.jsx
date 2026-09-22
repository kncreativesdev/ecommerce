import { cn } from '../../lib/cn.js';

const variantClasses = {
  primary:
    'bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]',
  secondary:
    'bg-surface text-secondary-foreground border border-border hover:bg-surface-muted active:scale-[0.98]',
  ghost: 'text-foreground hover:bg-surface-muted active:scale-[0.98]',
};

const sizeClasses = {
  sm: 'px-3 py-1.5 text-[13px] leading-[18px]',
  md: 'px-5 py-2.5 text-sm leading-5',
  lg: 'px-6 py-3 text-base leading-6',
};

/**
 * Design-system button. All variants resolve through semantic tokens so a
 * brand recolor in `src/index.css` propagates automatically.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant] ?? variantClasses.primary,
        sizeClasses[size] ?? sizeClasses.md,
        className,
      )}
      {...props}
    />
  );
}
