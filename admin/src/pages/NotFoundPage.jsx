import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';

/** Admin 404 inside the protected layout. */
export function NotFoundPage() {
  useEffect(() => {
    document.title = 'Page not found — Tech Pulse Admin';
  }, []);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-12 text-center shadow-sm">
      <span aria-hidden="true" className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
        <FileQuestion size={24} />
      </span>
      <p className="text-4xl font-extrabold tracking-tight text-foreground">404</p>
      <h2 className="text-base font-semibold text-foreground">Page not found</h2>
      <p className="text-sm text-muted-foreground">This admin page doesn’t exist or was moved.</p>
      <Link
        to="/dashboard"
        className="mt-1 inline-flex min-h-[44px] items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 hover:no-underline"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
