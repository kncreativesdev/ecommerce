import { useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore.js';

/**
 * Route-guard helper. Returns the admin gate state for `ProtectedRoute`:
 * - `checking` while the session is unresolved (loading gate, no login flash)
 * - `allowed` only for authenticated ADMIN users
 * - otherwise the route redirects to `/login?redirect=<path>`
 *
 * Frontend guards are UX layering; backend `authorize("ADMIN")` stays
 * authoritative on every write route.
 */
export function useRequireAdmin() {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    useAuthStore.getState().bootstrap();
  }, []);

  const isAdmin = Array.isArray(user?.roles) && user.roles.includes('ADMIN');

  return {
    checking: status === 'idle' || status === 'loading',
    allowed: status === 'ready' && isAdmin,
  };
}
