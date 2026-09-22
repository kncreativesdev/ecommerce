import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from './Button.jsx';
import { cn } from '../../lib/cn.js';

/** Section error card with retry. Page-level errors stay visible in-page. */
export function ErrorState({ title = 'Something went wrong', message, onRetry, retryLabel = 'Try again', className }) {
  return (
    <div
      role="alert"
      className={cn(
        'mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-10 text-center shadow-sm',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-destructive"
      >
        <TriangleAlert size={24} />
      </span>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {message ? <p className="text-sm leading-6 text-muted-foreground">{message}</p> : null}
      {onRetry ? (
        <Button onClick={onRetry} className="mt-1">
          <RotateCcw size={16} aria-hidden="true" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
