import { useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore.js';
import { ADMIN_PANEL_ROLES, hasAnyRole } from '../lib/roles.js';

/**
 * Route-guard helper. Returns the gate state for `ProtectedRoute`:
 * - `checking` while the session is unresolved (loading gate, no login flash)
 * - `allowed` for authenticated users holding any of `allowedRoles`
 *   (default: the four common admin-panel roles; ADMIN-only routes
 *   pass `['ADMIN']` explicitly to preserve their restriction)
 * - `bootstrapError` on transient bootstrap failure (429/5xx/network) —
 *   recoverable via `retryBootstrap`, never a false login redirect
 * - otherwise the route redirects to `/login?redirect=<path>`
 *
 * Frontend guards are UX layering; backend `authorize(...)` stays
 * authoritative on every route.
 */
export function useRequireAdmin(allowedRoles = ADMIN_PANEL_ROLES) {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const error = useAuthStore((state) => state.error);

  useEffect(() => {
    useAuthStore.getState().bootstrap();
  }, []);

  const admitted = status === 'ready' && hasAnyRole(user, allowedRoles);

  return {
    checking: status === 'idle' || status === 'loading',
    allowed: admitted,
    bootstrapError: status === 'error' ? error : null,
    retryBootstrap: () => useAuthStore.getState().bootstrap(),
  };
}
