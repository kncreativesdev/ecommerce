import { create } from 'zustand';
import { isSessionInvalidError, setAuthHandler, sharedRefresh } from '../lib/apiClient.js';
import { resetGuestSync, syncGuestAfterAuth } from '../lib/guestSync.js';
import {
  fetchCurrentUser,
  loginRequest,
  logoutRequest,
  refreshRequest,
  registerRequest,
} from '../services/auth.service.js';
import { useCartStore } from './useCartStore.js';
import { useWishlistStore } from './useWishlistStore.js';
import { useCheckoutStore } from './useCheckoutStore.js';
import { useNotificationsStore } from './useNotificationsStore.js';
import { useAnnouncementStore } from './useAnnouncementStore.js';

/**
 * Customer session state (Zustand) — FRONTEND_ARCHITECTURE.md §5.
 *
 * - `accessToken` lives in MEMORY ONLY (no persistence plugin, nothing in
 *   localStorage/sessionStorage). The refresh cookie is HttpOnly and
 *   browser-managed.
 * - `status`: `idle` (never bootstrapped) | `loading` (session resolving) |
 *   `ready` (settled — authenticated or not).
 * - `bootstrap()`: one coordinated silent-refresh attempt on app boot
 *   (shared single-flight with concurrent 401s), then `GET /auth/me`.
 *   Definitive rejection (`401`/`403` + `AUTH_*`) settles anonymous;
 *   transient failure (`429`/`5xx`/network) settles `error` — recoverable
 *   via retry, never a false logout, never a cookie destroy. Without a
 *   valid cookie the user stays logged out (no login flash, no error toast).
 * - `login()` / `registerThenLogin()` establish the session and return
 *   `{ ok }`; `logout()` always succeeds locally and clears all mirrors.
 * - `refreshAccessToken()` backs `apiClient`'s single-flight 401 flow
 *   (retry original once; second failure clears the session).
 */

export const useAuthStore = create((set, get) => ({
  accessToken: null,
  user: null,
  status: 'idle',
  lastError: null,

  isAuthenticated: () => Boolean(get().accessToken && get().user),

  setSession: async (accessToken, user) => {
    set({ accessToken, user, status: 'ready', lastError: null });
    useCartStore.getState().setSessionActive(true);
    useWishlistStore.getState().setSessionActive(true);
    // Merge any guest cart/wishlist into the account exactly once per
    // session; mirrors bootstrap only when nothing was merged.
    const { didMerge } = await syncGuestAfterAuth(user);
    if (!didMerge) {
      await bootstrapServerMirrors();
    }
  },

  clearSession: () => {
    set({ accessToken: null, user: null, status: 'ready', lastError: null });
    resetGuestSync();
    // De-authenticated UI must represent guest state — never stale
    // account mirrors. Server data persists server-side, untouched.
    // Checkout UI state (step, address picks) is per-session and must not
    // leak into the next login.
    useCartStore.getState().reset();
    useWishlistStore.getState().reset();
    useCheckoutStore.getState().reset();
    // Notification/announcement mirrors are per-user too: without this the
    // next login flashes the previous user's items/unread badge until the
    // bell refetches. Both stores refetch from scratch on demand.
    useNotificationsStore.getState().reset();
    useAnnouncementStore.getState().reset();
  },

  login: async ({ email, password }) => {
    set({ status: 'loading', lastError: null });
    try {
      const data = await loginRequest({ email, password });
      const user = data?.user ?? null;
      const accessToken = data?.accessToken ?? null;
      if (!user || !accessToken) {
        throw new Error('Sign-in did not return a session.');
      }
      get().setSession(accessToken, user);
      // Authoritative user shape after login.
      try {
        const me = await fetchCurrentUser();
        if (me) set({ user: me });
      } catch {
        /* Login session stands; `me` refreshes opportunistically. */
      }
      return { ok: true };
    } catch (error) {
      set({ accessToken: null, user: null, status: 'ready', lastError: error });
      return { ok: false, error };
    }
  },

  registerThenLogin: async (input) => {
    set({ status: 'loading', lastError: null });
    try {
      await registerRequest(input);
      // Backend register returns `data.user` with no token — auto-login.
      return await get().login({ email: input.email, password: input.password });
    } catch (error) {
      set({ accessToken: null, user: null, status: 'ready', lastError: error });
      return { ok: false, error };
    }
  },

  logout: async () => {
    try {
      await logoutRequest();
    } finally {
      get().clearSession();
    }
  },

  refreshAccessToken: async () => {
    const accessToken = await refreshRequest();
    if (!accessToken) {
      throw new Error('Session refresh failed.');
    }
    set({ accessToken });
    return accessToken;
  },

  bootstrap: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', lastError: null });
    let accessToken;
    try {
      // Shared single-flight with the 401 flow: bootstrap plus the page's
      // data requests resolve through ONE `/auth/refresh` hit, never two
      // racing refreshes per hard reload.
      accessToken = await sharedRefresh();
    } catch (error) {
      if (isSessionInvalidError(error)) {
        // Definitive: the refresh credential is unusable → anonymous.
        set({ accessToken: null, user: null, status: 'ready', lastError: null });
      } else {
        // Transient (429/5xx/network): recoverable bootstrap failure. The
        // HttpOnly cookie is untouched — guards must offer retry, never a
        // login redirect, and must NOT clear session mirrors.
        set({ status: 'error', lastError: error });
      }
      return;
    }
    if (!accessToken) {
      set({ accessToken: null, user: null, status: 'ready', lastError: null });
      return;
    }
    set({ accessToken });
    try {
      const user = await fetchCurrentUser();
      if (!user) {
        set({ accessToken: null, user: null, status: 'ready', lastError: null });
        return;
      }
      await get().setSession(accessToken, user);
    } catch (error) {
      if (isSessionInvalidError(error)) {
        set({ accessToken: null, user: null, status: 'ready', lastError: null });
      } else {
        // Token restored but identity fetch failed transiently: keep the
        // token so a retry resumes without another refresh attempt.
        set({ status: 'error', lastError: error });
      }
    }
  },
}));

// Wire the apiClient without an import cycle: the client calls back here.
setAuthHandler({
  getAccessToken: () => useAuthStore.getState().accessToken,
  refreshAccessToken: () => useAuthStore.getState().refreshAccessToken(),
  onAuthFailure: () => useAuthStore.getState().clearSession(),
});

/** Mirror bootstrap after session establishment (skipped when merge refreshed). */
async function bootstrapServerMirrors() {
  try {
    const { useCartStore } = await import('./useCartStore.js');
    await useCartStore.getState().bootstrap();
  } catch {
    /* Cart stays empty until reachable. */
  }
  try {
    const { useWishlistStore } = await import('./useWishlistStore.js');
    await useWishlistStore.getState().bootstrap();
  } catch {
    /* Wishlist stays empty until reachable. */
  }
}
