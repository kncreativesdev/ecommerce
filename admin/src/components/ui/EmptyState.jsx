import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn.js';

/** Centered empty state: icon, title, message, optional CTA link. */
export function EmptyState({ icon: Icon, title, message, actionTo, actionLabel, className }) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-10 text-center shadow-sm',
        className,
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-muted-foreground"
        >
          <Icon size={24} />
        </span>
      ) : null}
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {message ? <p className="text-sm leading-6 text-muted-foreground">{message}</p> : null}
      {actionTo && actionLabel ? (
        <Link
          to={actionTo}
          className="mt-1 inline-flex min-h-[44px] items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 hover:no-underline"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
