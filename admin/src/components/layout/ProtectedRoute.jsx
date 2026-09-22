import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useRequireAdmin } from '../../hooks/useRequireAdmin.js';

/**
 * Admin route guard (UX layering only — backend `authorize("ADMIN")`
 * remains authoritative). Shows a loading gate while the session resolves
 * (no login flash); otherwise redirects unauthenticated/non-admin users
 * to `/login?redirect=<path>` with internal-path validation.
 */
export function ProtectedRoute() {
  const { checking, allowed } = useRequireAdmin();
  const location = useLocation();

  if (checking) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background" role="status" aria-label="Checking session">
        <span aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-[3px] border-border-strong border-t-primary" />
      </div>
    );
  }

  if (!allowed) {
    const redirect = location.pathname + location.search;
    const safe = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard';
    return <Navigate to={`/login?redirect=${encodeURIComponent(safe)}`} replace />;
  }

  return <Outlet />;
}
