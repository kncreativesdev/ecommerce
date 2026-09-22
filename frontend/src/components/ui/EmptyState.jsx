import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn.js';

/**
 * Centered empty-state block: Lucide icon in a muted circle, semibold
 * title, muted message, optional primary CTA. One component, per-page copy
 * supplied by callers (PAGES.md).
 */
export function EmptyState({ icon: Icon, title, message, actionTo, actionLabel, className }) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center text-card-foreground shadow-sm',
        className,
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-muted-foreground"
        >
          <Icon size={26} />
        </span>
      ) : null}
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {message ? <p className="text-sm leading-6 text-muted-foreground">{message}</p> : null}
      {actionTo && actionLabel ? (
        <Link
          to={actionTo}
          className="mt-1 inline-flex min-h-[44px] items-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 hover:no-underline"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
