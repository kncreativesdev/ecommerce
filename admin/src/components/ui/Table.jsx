import { cn } from '../../lib/cn.js';

/**
 * Shared admin table shell: semantic markup (`table`/`th scope="col"`),
 * scrollable container LOCAL to the table (never body-level overflow),
 * token-driven borders/spacing. Callers render `<tr>` rows as children;
 * filtering/sorting/pagination stay caller-side (current admin scale needs
 * no data-grid framework).
 *
 * Row density is owned here, not per page: header cells use compact
 * padding and body cells inherit the same rhythm through the container,
 * so every consumer table stays compact and header/body columns stay
 * aligned. Per-cell extras (alignment, truncation, tabular numerals)
 * still apply — only the shared cell padding is centralized.
 */
export function Table({ caption, columns = [], minWidth = 'min-w-[720px]', className, children }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-border bg-card shadow-sm [&_td]:px-3 [&_td]:py-2.5', className)}>
      <table className={cn('w-full border-collapse text-left text-sm', minWidth)}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border bg-surface-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn('px-3 py-2.5 font-semibold', column.numeric && 'text-right', column.className)}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
