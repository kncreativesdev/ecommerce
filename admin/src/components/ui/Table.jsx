import { cn } from '../../lib/cn.js';

/**
 * Shared admin table shell: semantic markup (`table`/`th scope="col"`),
 * scrollable container LOCAL to the table (never body-level overflow),
 * token-driven borders/spacing. Callers render `<tr>` rows as children;
 * filtering/sorting/pagination stay caller-side (current admin scale needs
 * no data-grid framework).
 */
export function Table({ caption, columns = [], minWidth = 'min-w-[720px]', className, children }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-border bg-card shadow-sm', className)}>
      <table className={cn('w-full border-collapse text-left text-sm', minWidth)}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border bg-surface-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn('px-4 py-3 font-semibold', column.numeric && 'text-right', column.className)}
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
