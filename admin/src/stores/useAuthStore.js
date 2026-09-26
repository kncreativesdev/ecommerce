import { create } from 'zustand';
import { isSessionInvalidError, setAuthHandler, setTokenSink } from '../lib/apiClient.js';
import { fetchCurrentUser, loginRequest, logoutRequest } from '../services/auth.service.js';

/**
 * Admin session state (Zustand). Access token lives in MEMORY ONLY —
 * never localStorage/sessionStorage. The HttpOnly refresh cookie is
 * browser-managed and invisible to JS.
 *
 * Shape: `{ accessToken, user, status: idle|loading|ready|logged-out|error,
 * error }`. `isAdmin` derives from `user.roles[]` (server-provided).
 * Frontend role checks are UX layering; backend `authorize("ADMIN")`
 * remains authoritative on every write route.
 *
 * `status` distinguishes: `idle` (never bootstrapped) | `loading` |
 * `ready` (settled — authenticated or not) | `logged-out` (definitive:
 * invalid credential or explicit logout) | `error` (transient bootstrap
 * failure: 429/5xx/network — recoverable via retry, never a false logout,
 * never a cookie destroy).
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
   * lands logged-out unless the refresh cookie is still valid. The refresh
   * itself runs inside apiClient's single-flight, shared with concurrent
   * 401s (exactly one `/auth/refresh` per page load).
   *
   * Runs ONCE per page load for settled outcomes (`loading`/`ready`/
   * `logged-out` short-circuit): App plus every route guard calls this, and
   * re-running after a settled outcome would fire a fresh refresh per
   * navigation — a self-inflicted refresh storm that burns the refresh
   * budget into 429s. Only `idle` (never attempted) and `error`
   * (explicit user retry) may start a new attempt.
   *
   * A non-admin identity here clears LOCAL state only — it never calls
   * `logoutRequest`. The refresh cookie is shared with the storefront on
   * the same backend host (one `refresh_token` jar per browser profile),
   * so clearing it would destroy a customer session living in another
   * tab. The admin simply stays signed out; the other app is untouched.
   *
   * Transient failures (429/5xx/network) settle `error` — recoverable via
   * retry, never a false logout, never a cookie destroy. Only a definitive
   * auth rejection settles `logged-out`.
   */
  bootstrap: async () => {
    const settled = get().status === 'loading' || get().status === 'ready' || get().status === 'logged-out';
    if (settled) return;
    set({ status: 'loading', error: null });
    try {
      // Refresh first: apiClient attaches no bearer, gets 401, refreshes
      // via cookie, then retries `me` with the rotated token.
      const user = await fetchCurrentUser();
      if (!isAdminUser(user)) {
        set({ accessToken: null, user: null, status: 'logged-out', error: null });
        return;
      }
      set({ user, status: 'ready', error: null });
    } catch (error) {
      if (isSessionInvalidError(error)) {
        set({ accessToken: null, user: null, status: 'logged-out', error: null });
      } else {
        set({ status: 'error', error });
      }
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
