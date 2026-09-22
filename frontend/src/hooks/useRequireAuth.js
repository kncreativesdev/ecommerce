import { useAuthStore } from '../stores/useAuthStore.js';

/**
 * Route-guard helper. Returns `{ status, isAuthenticated }` so
 * `<ProtectedRoute>` can show a loading gate (never a login flash) while
 * `status === "loading" | "idle"`, and redirect otherwise.
 */
export function useRequireAuth() {
  const status = useAuthStore((state) => state.status);
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);

  return {
    status,
    isAuthenticated: Boolean(accessToken && user),
  };
}
