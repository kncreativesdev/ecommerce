import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useRequireAdmin } from '../../hooks/useRequireAdmin.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { ErrorState } from '../ui/ErrorState.jsx';

/**
 * Route guard (UX layering only — backend `authorize(...)` remains
 * authoritative). Shows a loading gate while the session resolves
 * (no login flash); a transient bootstrap failure (429/5xx/network) shows
 * a recoverable error panel with retry (never a false login redirect);
 * otherwise redirects to login.
 *
 * Redirect target (loop-free by construction): unauthenticated visitors
 * keep `?redirect=<path>` so a fresh login lands where they were
 * headed; already-authenticated users who simply lack the route's
 * roles go to plain `/login`, where the role-aware landing sends
 * them to a permitted page. Carrying `redirect` for the latter would
 * ping-pong them between login and the forbidden route forever
 * (e.g. ADMIN deep-linking a SUPER_ADMIN-only page).
 *
 * `allowedRoles` defaults to the common admin-panel roles
 * (SUPER_ADMIN/ADMIN/HEAD/MEMBER); ADMIN-only routes pass `['ADMIN']`
 * explicitly so their restriction is preserved per route.
 */
export function ProtectedRoute({ allowedRoles }) {
  const { checking, allowed, bootstrapError, retryBootstrap } = useRequireAdmin(allowedRoles);
  const location = useLocation();
  const user = useAuthStore((state) => state.user);

  if (checking) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background" role="status" aria-label="Checking session">
        <span aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-[3px] border-border-strong border-t-primary" />
      </div>
    );
  }

  if (bootstrapError) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4">
        <ErrorState
          title="Couldn’t restore your session"
          message={bootstrapError?.message ?? 'Check your connection and try again — you have not been signed out.'}
          onRetry={retryBootstrap}
        />
      </div>
    );
  }

  if (!allowed) {
    // Authenticated users lacking the route roles go to plain `/login`
    // (role-aware landing handles the rest); only logged-out visitors
    // keep the deep-link `redirect` target.
    if (user) {
      return <Navigate to="/login" replace />;
    }
    const redirect = location.pathname + location.search;
    const safe = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard';
    return <Navigate to={`/login?redirect=${encodeURIComponent(safe)}`} replace />;
  }

  return <Outlet />;
}
