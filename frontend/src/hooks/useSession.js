import { useAuthStore } from '../stores/useAuthStore.js';

/**
 * Public session hook for header/UI components. Wraps the auth store so UI
 * code never touches tokens, `localStorage`, or `document` directly.
 * Shape (per FRONTEND_ARCHITECTURE.md §5): `{ user, isAuthenticated,
 * status, signOut }`.
 */
export function useSession() {
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const status = useAuthStore((state) => state.status);
  const logout = useAuthStore((state) => state.logout);

  return {
    user,
    isAuthenticated: Boolean(accessToken && user),
    status,
    signOut: logout,
  };
}
