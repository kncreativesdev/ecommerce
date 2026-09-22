import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Container } from '../components/ui/Container.jsx';

/**
 * Catch-all not-found page for unknown routes and (in later milestones)
 * resource 404s — missing/inactive product/category, or another user's
 * order/review/address (never distinguished).
 */
export function NotFoundPage() {
  useEffect(() => {
    document.title = 'Page not found — Tech Pulse';
  }, []);

  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <p className="text-5xl font-extrabold tracking-tight text-primary" aria-hidden="true">
          404
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          The page you are looking for does not exist or may have moved.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link
            to="/"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 hover:no-underline"
          >
            Go to home
          </Link>
          <Link
            to="/shop"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-secondary-foreground transition-colors duration-200 hover:bg-surface-muted hover:no-underline"
          >
            Browse the shop
          </Link>
        </div>
      </div>
    </Container>
  );
}
