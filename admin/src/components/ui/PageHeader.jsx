/**
 * Shared admin page header: title + optional description/count + optional
 * action slot. Keeps list/form page introductions visually consistent
 * without restyling existing pages.
 */
export function PageHeader({ title, description, meta, actions }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-bold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
        {meta ? (
          <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">
            {meta}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
