import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/**
 * Breadcrumb trail: `[{ label, to? }]`. Last item renders as
 * `aria-current="page"` text; earlier items link. Home-first by convention.
 */
export function Breadcrumbs({ items = [] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <Fragment key={`${item.label}-${index}`}>
            {index > 0 ? (
              <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
            ) : null}
            {isLast || !item.to ? (
              <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                {item.label}
              </span>
            ) : (
              <Link
                to={item.to}
                className="text-muted-foreground transition-colors duration-200 hover:text-accent hover:no-underline"
              >
                {item.label}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
