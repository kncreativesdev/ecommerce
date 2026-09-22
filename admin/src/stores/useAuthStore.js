import { create } from 'zustand';
import { setAuthHandler, setTokenSink } from '../lib/apiClient.js';
import { fetchCurrentUser, loginRequest, logoutRequest } from '../services/auth.service.js';

/**
 * Admin session state (Zustand). Access token lives in MEMORY ONLY —
 * never localStorage/sessionStorage. The HttpOnly refresh cookie is
 * browser-managed and invisible to JS.
 *
 * Shape: `{ accessToken, user, status: idle|loading|ready|logged-out,
 * error }`. `isAdmin` derives from `user.roles[]` (server-provided).
 * Frontend role checks are UX layering; backend `authorize("ADMIN")`
 * remains authoritative on every write route.
 */

export function isAdminUser(user) {
  return Array.isArray(user?.roles) && user.roles.includes('ADMIN');
}

export const useAuthStore = create((set, get) => ({
  accessToken: null,
  user: null,
  status: 'idle',
  error: null,

  isAdmin: () => isAdminUser(get().user),

  /** Login → require ADMIN role, else sign straight back out. */
  login: async ({ email, password }) => {
    set({ status: 'loading', error: null });
    try {
      const data = await loginRequest({ email, password });
      const user = data?.user ?? null;
      if (!isAdminUser(user)) {
        await logoutRequest();
        set({
          accessToken: null,
          user: null,
          status: 'logged-out',
          error: { message: 'This account does not have admin access.', code: 'NOT_ADMIN' },
        });
        return { ok: false };
      }
      set({
        accessToken: data?.accessToken ?? null,
        user,
        status: 'ready',
        error: null,
      });
      return { ok: true };
    } catch (error) {
      set({
        accessToken: null,
        user: null,
        status: 'logged-out',
        error: { message: error?.message ?? 'Sign in failed.', code: error?.code },
      });
      return { ok: false };
    }
  },

  /** Logout always succeeds locally, even if the call fails. */
  logout: async () => {
    await logoutRequest();
    set({ accessToken: null, user: null, status: 'logged-out', error: null });
  },

  /** Session expired/invalid (from apiClient) → clear state. */
  handleUnauthorized: () => {
    set({ accessToken: null, user: null, status: 'logged-out', error: null });
  },

  /**
   * Boot: one silent refresh (cookie) → `GET /auth/me` → require ADMIN.
   * No persisted token is ever read — a reload without a live session
   * lands logged-out unless the refresh cookie is still valid.
   */
  bootstrap: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null });
    try {
      // Refresh first: apiClient attaches no bearer, gets 401, refreshes
      // via cookie, then retries `me` with the rotated token.
      const user = await fetchCurrentUser();
      if (!isAdminUser(user)) {
        await logoutRequest();
        set({ accessToken: null, user: null, status: 'logged-out', error: null });
        return;
      }
      set({ user, status: 'ready', error: null });
    } catch {
      set({ accessToken: null, user: null, status: 'logged-out', error: null });
    }
  },

  clearError: () => set({ error: null }),
}));

// Wire the apiClient without an import cycle: the client calls back here.
setAuthHandler({
  getAccessToken: () => useAuthStore.getState().accessToken,
  onUnauthorized: () => useAuthStore.getState().handleUnauthorized(),
});
setTokenSink((accessToken) => {
  if (accessToken) useAuthStore.setState({ accessToken });
});
