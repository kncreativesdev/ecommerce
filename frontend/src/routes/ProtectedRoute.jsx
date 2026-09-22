import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useRequireAuth } from '../hooks/useRequireAuth.js';

/**
 * Auth gate for protected customer routes. While the session resolves a
 * loading gate renders (never a login flash); unauthenticated visitors go
 * to `/login?redirect=<encoded path>`, validated as an internal path.
 */
export function ProtectedRoute() {
  const { status, isAuthenticated } = useRequireAuth();
  const location = useLocation();

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="tp-container flex flex-1 items-center justify-center py-16" role="status" aria-label="Checking session">
        <span aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-[3px] border-border-strong border-t-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const redirect = `${location.pathname}${location.search}`;
    const safe = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/account';
    return <Navigate to={`/login?redirect=${encodeURIComponent(safe)}`} replace />;
  }

  return <Outlet />;
}
