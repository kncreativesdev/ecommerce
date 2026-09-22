import { cn } from '../../lib/cn.js';

/**
 * Accessible field wrapper: label (+ required marker), control slot, and
 * error text wired via `aria-describedby`. Use for every form control.
 */
export function Field({ label, required = false, error, hint, children, className }) {
  const errorId = error ? `${label}-error` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label className="text-[13px] font-semibold text-foreground">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-destructive">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {typeof children === 'function' ? children({ errorId }) : children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlClass = (hasError) =>
  cn(
    'min-h-[44px] w-full rounded-lg border bg-surface px-3.5 text-sm text-foreground placeholder:text-muted-foreground',
    'transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30',
    hasError ? 'border-destructive' : 'border-input hover:border-border-strong',
  );

export function Input({ hasError = false, className, ...props }) {
  return <input className={cn(controlClass(hasError), className)} {...props} />;
}

export function Textarea({ hasError = false, className, ...props }) {
  return <textarea rows={3} className={cn(controlClass(hasError), 'py-2.5', className)} {...props} />;
}

export function Select({ hasError = false, className, children, ...props }) {
  return (
    <select className={cn(controlClass(hasError), 'cursor-pointer', className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ label, className, ...props }) {
  return (
    <label className={cn('inline-flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm font-medium text-foreground', className)}>
      <input
        type="checkbox"
        className="h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-primary)]"
        {...props}
      />
      {label}
    </label>
  );
}
