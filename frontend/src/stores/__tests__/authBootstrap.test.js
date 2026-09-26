import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, setAuthHandler } from '../../lib/apiClient.js';
import { loginRequest } from '../../services/auth.service.js';
import { useAuthStore } from '../useAuthStore.js';

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

function routeFetch({ refresh = 'ok', meUser = { id: 'u1', email: 'u@example.com' } } = {}) {
  const calls = { refresh: 0, logout: 0, login: 0 };
  const mock = vi.fn(async (url, init = {}) => {
    if (url.endsWith('/auth/refresh')) {
      calls.refresh += 1;
      if (refresh === 'ok') return jsonResponse({ success: true, data: { accessToken: 'fresh-token' } });
      if (refresh === 'invalid') {
        return jsonResponse(
          { success: false, error: { code: 'AUTH_REFRESH_TOKEN_INVALID', message: 'Refresh token is missing or invalid' } },
          { ok: false, status: 401 },
        );
      }
      if (refresh === 'throttled') {
        return jsonResponse(
          { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' } },
          { ok: false, status: 429 },
        );
      }
      throw new Error('unreachable');
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
      const authed = Boolean(init.headers?.Authorization);
      if (!authed) {
        return jsonResponse(
          { success: false, error: { code: 'AUTH_UNAUTHORIZED', message: 'Authentication required' } },
          { ok: false, status: 401 },
        );
      }
      return jsonResponse({ success: true, data: { user: meUser } });
    }
    // Any other endpoint: bearer → data, else expired-token 401.
    if (init.headers?.Authorization) return jsonResponse({ success: true, data: [{ id: 'o1' }] });
    return jsonResponse(
      { success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Access token has expired' } },
      { ok: false, status: 401 },
    );
  });
  return { mock, calls };
}

function resetAuth() {
  useAuthStore.setState({ accessToken: null, user: null, status: 'idle', lastError: null });
}

function wireSpies() {
  const onAuthFailure = vi.fn();
  setAuthHandler({
    getAccessToken: () => useAuthStore.getState().accessToken,
    refreshAccessToken: () => useAuthStore.getState().refreshAccessToken(),
    onAuthFailure,
  });
  return { onAuthFailure };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetAuth();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Restore the module's real wiring for sibling suites.
  setAuthHandler({
    getAccessToken: () => useAuthStore.getState().accessToken,
    refreshAccessToken: () => useAuthStore.getState().refreshAccessToken(),
    onAuthFailure: () => useAuthStore.getState().clearSession(),
  });
  resetAuth();
});

describe('auth bootstrap single-flight (hard-refresh equivalent)', () => {
  it('bootstrap + concurrent 401s share exactly one refresh; all callers succeed', async () => {
    const { mock, calls } = routeFetch();
    vi.stubGlobal('fetch', mock);
    const { onAuthFailure } = wireSpies();

    // All callers attach synchronously before any promise resolves, so the
    // refresh is still in flight for every one of them — deterministic
    // single-flight sharing without artificial gates.
    const bootstrapping = useAuthStore.getState().bootstrap();
    const readers = Array.from({ length: 5 }, () => apiGet('/orders'));
    const [ , ...orders ] = await Promise.all([bootstrapping, ...readers]);

    expect(calls.refresh).toBe(1);
    expect(onAuthFailure).not.toHaveBeenCalled();
    for (const page of orders) expect(page).toEqual([{ id: 'o1' }]);
    const state = useAuthStore.getState();
    expect(state.status).toBe('ready');
    expect(state.accessToken).toBe('fresh-token');
    expect(state.user).toEqual({ id: 'u1', email: 'u@example.com' });
  });

  it('repeated bootstrap calls emit a single refresh', async () => {
    const { mock, calls } = routeFetch();
    vi.stubGlobal('fetch', mock);
    wireSpies();

    await Promise.all([
      useAuthStore.getState().bootstrap(),
      useAuthStore.getState().bootstrap(),
      useAuthStore.getState().bootstrap(),
    ]);

    expect(calls.refresh).toBe(1);
    expect(useAuthStore.getState().status).toBe('ready');
  });

  it('throttled refresh (429) settles error — no logout, no cookie destroy, mirrors kept', async () => {
    const { mock, calls } = routeFetch({ refresh: 'throttled' });
    vi.stubGlobal('fetch', mock);
    const { onAuthFailure } = wireSpies();

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.lastError).toMatchObject({ status: 429, code: 'RATE_LIMIT_EXCEEDED' });
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(calls.logout).toBe(0);
    expect(calls.refresh).toBe(1);
  });

  it('definitively invalid refresh settles anonymous without destroying the cookie', async () => {
    const { mock, calls } = routeFetch({ refresh: 'invalid' });
    vi.stubGlobal('fetch', mock);
    wireSpies();

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe('ready');
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(calls.logout).toBe(0);
  });

  it('bad-credential login never triggers a refresh nor clears the session', async () => {
    const { mock, calls } = routeFetch();
    vi.stubGlobal('fetch', mock);
    const { onAuthFailure } = wireSpies();
    useAuthStore.setState({ accessToken: 'live-token', user: { id: 'u1' }, status: 'ready' });

    await expect(loginRequest({ email: 'u@example.com', password: 'wrong' })).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    expect(calls.refresh).toBe(0);
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(useAuthStore.getState().accessToken).toBe('live-token');
  });
});
