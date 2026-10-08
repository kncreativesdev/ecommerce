import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useRequireAuth } from '../hooks/useRequireAuth.js';
import { useAuthStore } from '../stores/useAuthStore.js';
import { COMPANY_SUSPENDED_CODE, SUSPENSION_MESSAGE, SUSPENSION_TITLE } from '../lib/suspension.js';
import { ErrorState } from '../components/ui/ErrorState.jsx';

/**
 * Auth gate for protected customer routes. While the session resolves a
 * loading gate renders (never a login flash); a transient bootstrap
 * failure (429/5xx/network) renders a recoverable error panel with retry
 * — never a false login redirect; a suspended company renders the
 * dedicated suspended state (never protected content, never a login
 * redirect — signing in cannot bypass suspension); unauthenticated
 * visitors go to `/login?redirect=<encoded path>`, validated as an
 * internal path.
 */
export function ProtectedRoute() {
  const { status, isAuthenticated, lastError } = useRequireAuth();
  const location = useLocation();

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="tp-container flex flex-1 items-center justify-center py-16" role="status" aria-label="Checking session">
        <span aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-[3px] border-border-strong border-t-primary" />
      </div>
    );
  }

  if (status === 'error') {
    // Exact-code match only: any other 403 keeps the generic recoverable
    // panel below.
    if (lastError?.code === COMPANY_SUSPENDED_CODE) {
      return (
        <div className="tp-container flex flex-1 items-center justify-center py-16">
          <ErrorState
            title={SUSPENSION_TITLE}
            message={SUSPENSION_MESSAGE}
            onRetry={() => useAuthStore.getState().bootstrap()}
          />
        </div>
      );
    }
    return (
      <div className="tp-container flex flex-1 items-center justify-center py-16">
        <ErrorState
          title="Couldn’t restore your session"
          message={lastError?.message ?? 'Check your connection and try again — you have not been signed out.'}
          onRetry={() => useAuthStore.getState().bootstrap()}
        />
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
