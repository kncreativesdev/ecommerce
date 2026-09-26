import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiGet,
  apiGetPage,
  isSessionInvalidError,
  setAuthHandler,
  setTokenSink,
} from '../apiClient.js';

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

afterEach(() => {
  vi.unstubAllGlobals();
  // Restore the neutral handler so refresh-guard suites start clean.
  setAuthHandler({ getAccessToken: () => null, onUnauthorized: () => {} });
  setTokenSink(null);
});

describe('apiClient envelope handling', () => {
  it('apiGetPage preserves top-level meta while apiGet returns data only', async () => {
    const payload = { success: true, data: { coupons: [{ id: 'c1' }] }, meta: { total: 42, totalPages: 3 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));

    const page = await apiGetPage('/coupons?page=1&limit=20');
    expect(page).toEqual({ data: { coupons: [{ id: 'c1' }] }, meta: { total: 42, totalPages: 3 } });

    // The plain helper intentionally drops meta — paginated adapters must
    // use apiGetPage or totals silently default (the stale "0 coupons" bug).
    const dataOnly = await apiGet('/coupons?page=1&limit=20');
    expect(dataOnly).toEqual({ coupons: [{ id: 'c1' }] });
    expect(dataOnly.meta).toBeUndefined();
  });

  it('surfaces backend error envelopes as ApiError on both helpers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: { code: 'COUPON_NOT_FOUND', message: 'Missing' } }, { ok: false, status: 404 })),
    );

    await expect(apiGetPage('/coupons/nope')).rejects.toMatchObject({ status: 404, code: 'COUPON_NOT_FOUND' });
    await expect(apiGet('/coupons/nope')).rejects.toBeInstanceOf(ApiError);
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
  function wire(handler = {}) {
    const onUnauthorized = vi.fn();
    let token = handler.token ?? 'expired-token';
    setAuthHandler({
      getAccessToken: () => token,
      onUnauthorized,
    });
    setTokenSink((next) => {
      token = next;
    });
    return { onUnauthorized, getToken: () => token };
  }

  it('401 + invalid refresh → one refresh, logout once, no retry loop', async () => {
    const { onUnauthorized } = wire();
    const fetchMock = vi.fn()
      // Original request: expired access token.
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Access token has expired' } }, { ok: false, status: 401 }))
      // Single-flight refresh: rejected credential.
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_REFRESH_TOKEN_INVALID', message: 'Refresh token is missing or invalid' } }, { ok: false, status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/orders/admin/o1')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('401 + throttled refresh (429) → NO logout, transient surfaces, original never retried', async () => {
    const { onUnauthorized } = wire();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Access token has expired' } }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' } }, { ok: false, status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/orders/admin/o1')).rejects.toMatchObject({ status: 429, code: 'RATE_LIMIT_EXCEEDED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('401 + unreachable refresh (network) → NO logout, network error surfaces', async () => {
    const { onUnauthorized } = wire();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Access token has expired' } }, { ok: false, status: 401 }))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/orders/admin/o1')).rejects.toMatchObject({ message: 'Network error. Check your connection and retry.' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('401 + valid refresh → retries original exactly once with the rotated token', async () => {
    const { onUnauthorized } = wire();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { accessToken: 'fresh-token' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { order: { id: 'o1', status: 'CONFIRMED' } } }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await apiGet('/orders/admin/o1');
    expect(data).toEqual({ order: { id: 'o1', status: 'CONFIRMED' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onUnauthorized).not.toHaveBeenCalled();
    // The rotated token rode the retried request as a bearer.
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh-token');
  });

  it('second 401 after retry → logout once, no further refresh (no loop)', async () => {
    const { onUnauthorized } = wire();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { accessToken: 'fresh-token' } }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'AUTH_UNAUTHORIZED', message: 'Authentication required' } }, { ok: false, status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/orders/admin/o1')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('concurrent 401s share a single in-flight refresh', async () => {
    const { onUnauthorized } = wire();
    const expired = () => jsonResponse({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { ok: false, status: 401 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { accessToken: 'shared-fresh' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { order: { id: 'o1' } } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { order: { id: 'o2' } } }));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([apiGet('/orders/admin/o1'), apiGet('/orders/admin/o2')]);
    expect(first).toEqual({ order: { id: 'o1' } });
    expect(second).toEqual({ order: { id: 'o2' } });
    // Two originals + ONE shared refresh + two retries — never a storm.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
