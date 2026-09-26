import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiGet,
  apiRequest,
  isSessionInvalidError,
  setAuthHandler,
} from '../apiClient.js';

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

afterEach(() => {
  vi.unstubAllGlobals();
  // Restore the neutral handler so suites start clean.
  setAuthHandler({
    getAccessToken: () => null,
    refreshAccessToken: async () => null,
    onAuthFailure: () => {},
  });
});

describe('isSessionInvalidError (logout gate)', () => {
  it('treats explicit auth rejections as session-invalid', () => {
    expect(isSessionInvalidError(new ApiError({ status: 401, code: 'AUTH_REFRESH_TOKEN_INVALID' }))).toBe(true);
    expect(isSessionInvalidError(new ApiError({ status: 401, code: 'AUTH_TOKEN_EXPIRED' }))).toBe(true);
    expect(isSessionInvalidError(new ApiError({ status: 403, code: 'AUTH_ACCOUNT_INACTIVE' }))).toBe(true);
  });

  it('never treats transients as session-invalid', () => {
    expect(isSessionInvalidError(new ApiError({ status: 429, code: 'RATE_LIMIT_EXCEEDED' }))).toBe(false);
    expect(isSessionInvalidError(new ApiError({ status: 500, code: 'INTERNAL_SERVER_ERROR' }))).toBe(false);
    expect(isSessionInvalidError(new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Network error.' }))).toBe(false);
    expect(isSessionInvalidError(new ApiError({ status: 401, code: 'RATE_LIMIT_EXCEEDED' }))).toBe(false);
    expect(isSessionInvalidError(new Error('boom'))).toBe(false);
    expect(isSessionInvalidError(null)).toBe(false);
  });
});

describe('apiClient refresh retry guards', () => {
  function wire({ token = 'expired-token', refreshImpl } = {}) {
    const onAuthFailure = vi.fn();
    let current = token;
    const refreshAccessToken = refreshImpl
      ?? (async () => {
        const response = await fetch('http://localhost:3000/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        const payload = await response.json();
        if (!response.ok || payload?.success === false || !payload?.data?.accessToken) {
          const error = payload?.error ?? {};
          throw new ApiError({
            status: response.status,
            code: error.code ?? `HTTP_${response.status}`,
            message: error.message ?? 'Request failed.',
          });
        }
        current = payload.data.accessToken;
        return current;
      });
    const refreshSpy = vi.fn(refreshAccessToken);
    setAuthHandler({
      getAccessToken: () => current,
      refreshAccessToken: refreshSpy,
      onAuthFailure,
    });
    return { onAuthFailure, refreshSpy };
  }

  it('401 + invalid refresh → clears session once, no retry loop', async () => {
    const { onAuthFailure, refreshSpy } = wire();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_REFRESH_TOKEN_INVALID', message: 'invalid' } }, { ok: false, status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/orders')).rejects.toMatchObject({ status: 401 });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('401 + throttled refresh (429) → session KEPT, transient surfaces, mirrors untouched', async () => {
    const { onAuthFailure, refreshSpy } = wire();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' } }, { ok: false, status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/orders')).rejects.toMatchObject({ status: 429, code: 'RATE_LIMIT_EXCEEDED' });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('401 + unreachable refresh (network) → session KEPT, network error surfaces', async () => {
    const { onAuthFailure } = wire({ refreshImpl: async () => { throw new ApiError({ message: 'Network error. Check your connection and retry.' }); } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { ok: false, status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/orders')).rejects.toMatchObject({ message: 'Network error. Check your connection and retry.' });
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('401 + valid refresh → retries original exactly once', async () => {
    const { onAuthFailure, refreshSpy } = wire();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { accessToken: 'fresh-token' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [{ id: 'o1' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/orders')).resolves.toEqual([{ id: 'o1' }]);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('second 401 after retry → clears session once, no further refresh (no loop)', async () => {
    const { onAuthFailure, refreshSpy } = wire();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { accessToken: 'fresh-token' } }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_UNAUTHORIZED', message: 'denied' } }, { ok: false, status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/orders')).rejects.toMatchObject({ status: 401 });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refresh call itself (skipAuthRefresh) never triggers a nested refresh — no deadlock', async () => {
    const { onAuthFailure, refreshSpy } = wire();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_REFRESH_TOKEN_INVALID', message: 'invalid' } }, { ok: false, status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiRequest('/auth/refresh', { method: 'POST', credentials: 'include', skipAuthRefresh: true }),
    ).rejects.toMatchObject({ status: 401, code: 'AUTH_REFRESH_TOKEN_INVALID' });
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('concurrent 401s share a single in-flight refresh', async () => {
    const { onAuthFailure, refreshSpy } = wire();
    const expired = () => jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { ok: false, status: 401 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { accessToken: 'shared-fresh' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [{ id: 'o1' }] }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [{ id: 'o2' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([apiGet('/orders'), apiGet('/orders/2')]);
    expect(first).toEqual([{ id: 'o1' }]);
    expect(second).toEqual([{ id: 'o2' }]);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });
});
