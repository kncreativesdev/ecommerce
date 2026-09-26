import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, setAuthHandler, setTokenSink } from '../../lib/apiClient.js';
import { loginRequest } from '../../services/auth.service.js';
import { useAuthStore } from '../useAuthStore.js';

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

const ADMIN_USER = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] };

function routeFetch({ refresh = 'ok', meUser = ADMIN_USER } = {}) {
  const calls = { refresh: 0, logout: 0, login: 0 };
  const mock = vi.fn(async (url, init = {}) => {
    if (url.endsWith('/auth/refresh')) {
      calls.refresh += 1;
      if (refresh === 'ok') return jsonResponse({ success: true, data: { accessToken: 'fresh-admin-token' } });
      if (refresh === 'invalid') {
        return jsonResponse(
          { success: false, error: { code: 'AUTH_REFRESH_TOKEN_INVALID', message: 'Refresh token is missing or invalid' } },
          { ok: false, status: 401 },
        );
      }
      return jsonResponse(
        { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' } },
        { ok: false, status: 429 },
      );
    }
    if (url.endsWith('/auth/logout')) {
      calls.logout += 1;
      return jsonResponse({ success: true, data: { message: 'Logged out successfully' } });
    }
    if (url.endsWith('/auth/login')) {
      calls.login += 1;
      return jsonResponse(
        { success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password' } },
        { ok: false, status: 401 },
      );
    }
    if (url.endsWith('/auth/me')) {
      if (!init.headers?.Authorization) {
        return jsonResponse(
          { success: false, error: { code: 'AUTH_UNAUTHORIZED', message: 'Authentication required' } },
          { ok: false, status: 401 },
        );
      }
      return jsonResponse({ success: true, data: { user: meUser } });
    }
    if (init.headers?.Authorization) return jsonResponse({ success: true, data: { orders: [] } });
    return jsonResponse(
      { success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Access token has expired' } },
      { ok: false, status: 401 },
    );
  });
  return { mock, calls };
}

function resetAuth() {
  useAuthStore.setState({ accessToken: null, user: null, status: 'idle', error: null });
}

function wireSpies() {
  const onUnauthorized = vi.fn();
  setAuthHandler({
    getAccessToken: () => useAuthStore.getState().accessToken,
    onUnauthorized,
  });
  setTokenSink((accessToken) => {
    if (accessToken) useAuthStore.setState({ accessToken });
  });
  return { onUnauthorized };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetAuth();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthHandler({
    getAccessToken: () => useAuthStore.getState().accessToken,
    onUnauthorized: () => useAuthStore.getState().handleUnauthorized(),
  });
  setTokenSink((accessToken) => {
    if (accessToken) useAuthStore.setState({ accessToken });
  });
  resetAuth();
});

describe('admin auth bootstrap (hard-refresh equivalent)', () => {
  it('bootstrap + concurrent 401s share exactly one refresh; session restored', async () => {
    const { mock, calls } = routeFetch();
    vi.stubGlobal('fetch', mock);
    const { onUnauthorized } = wireSpies();

    const bootstrapping = useAuthStore.getState().bootstrap();
    const readers = Array.from({ length: 5 }, () => apiGet('/orders/admin?page=1'));
    const [ , ...pages ] = await Promise.all([bootstrapping, ...readers]);

    expect(calls.refresh).toBe(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
    for (const page of pages) expect(page).toEqual({ orders: [] });
    const state = useAuthStore.getState();
    expect(state.status).toBe('ready');
    expect(state.accessToken).toBe('fresh-admin-token');
    expect(state.user).toEqual(ADMIN_USER);
  });

  it('bootstrap runs once per page load — repeat calls emit no further refresh', async () => {
    const { mock, calls } = routeFetch();
    vi.stubGlobal('fetch', mock);
    wireSpies();

    await useAuthStore.getState().bootstrap();
    await useAuthStore.getState().bootstrap();
    await useAuthStore.getState().bootstrap();

    expect(calls.refresh).toBe(1);
  });

  it('throttled refresh settles error — no logout, no cookie destroy', async () => {
    const { mock, calls } = routeFetch({ refresh: 'throttled' });
    vi.stubGlobal('fetch', mock);
    const { onUnauthorized } = wireSpies();

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toMatchObject({ status: 429 });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(calls.logout).toBe(0);
  });

  it('definitively invalid refresh settles logged-out without server logout', async () => {
    const { mock, calls } = routeFetch({ refresh: 'invalid' });
    vi.stubGlobal('fetch', mock);
    wireSpies();

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe('logged-out');
    expect(state.accessToken).toBeNull();
    expect(calls.logout).toBe(0);
  });

  it('non-admin identity signs out locally only — shared customer cookie survives', async () => {
    const { mock, calls } = routeFetch({ meUser: { id: 'u1', roles: ['CUSTOMER'] } });
    vi.stubGlobal('fetch', mock);
    wireSpies();

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe('logged-out');
    expect(state.user).toBeNull();
    expect(calls.logout).toBe(0);
  });

  it('bad-credential login never triggers a refresh nor clears the session', async () => {
    const { mock, calls } = routeFetch();
    vi.stubGlobal('fetch', mock);
    const { onUnauthorized } = wireSpies();
    useAuthStore.setState({ accessToken: 'live-token', user: ADMIN_USER, status: 'ready' });

    await expect(loginRequest({ email: 'a@example.com', password: 'wrong' })).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    expect(calls.refresh).toBe(0);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(useAuthStore.getState().accessToken).toBe('live-token');
  });
});
