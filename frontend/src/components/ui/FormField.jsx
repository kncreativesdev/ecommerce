import { cn } from '../../lib/cn.js';

/**
 * Form field wrapper for React Hook Form: label, control slot, and error
 * text wired via `aria-describedby`. `error` is the RHF message string.
 */
export function FormField({ label, required = false, error, hint, children, className }) {
  const describedBy = error ? `${label}-error` : hint ? `${label}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label className="text-[13px] font-semibold text-foreground">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </label>
      {typeof children === 'function' ? children({ describedBy }) : children}
      {hint && !error ? (
        <p id={`${label}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${label}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlClass = (hasError) =>
  cn(
    'min-h-[44px] w-full rounded-xl border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground',
    'transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60',
    hasError ? 'border-destructive' : 'border-input hover:border-border-strong',
  );

/** Token-styled text input for forms. */
export function TextInput({ hasError = false, className, ...props }) {
  return <input className={cn(controlClass(hasError), className)} {...props} />;
}

/** Token-styled textarea for forms. */
export function TextArea({ hasError = false, className, ...props }) {
  return <textarea rows={4} className={cn(controlClass(hasError), className)} {...props} />;
}

/** Token-styled select for forms. */
export function SelectInput({ hasError = false, className, children, ...props }) {
  return (
    <select className={cn(controlClass(hasError), 'cursor-pointer', className)} {...props}>
      {children}
    </select>
  );
}
