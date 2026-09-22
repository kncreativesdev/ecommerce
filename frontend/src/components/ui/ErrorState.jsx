import { RotateCcw, TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/**
 * Section error card with retry: icon, message, and a retry affordance.
 * Page-level errors stay visible in the page (no `alert()`, no toast for
 * load failures). Callers pass `onRetry`; omit it for non-retryable states.
 */
export function ErrorState({ title = 'Something went wrong', message, onRetry, retryLabel = 'Try again', className }) {
  return (
    <div
      role="alert"
      className={cn(
        'mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center text-card-foreground shadow-sm',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-destructive"
      >
        <TriangleAlert size={26} />
      </span>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {message ? <p className="text-sm leading-6 text-muted-foreground">{message}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90"
        >
          <RotateCcw size={16} aria-hidden="true" />
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
