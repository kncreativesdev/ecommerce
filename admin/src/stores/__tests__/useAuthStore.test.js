import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../useAuthStore.js';
import { fetchCurrentUser, loginRequest, logoutRequest } from '../../services/auth.service.js';

vi.mock('../../services/auth.service.js', () => ({
  fetchCurrentUser: vi.fn(),
  loginRequest: vi.fn(),
  logoutRequest: vi.fn(),
}));

function resetStore() {
  useAuthStore.setState({ accessToken: null, user: null, status: 'idle', error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

/**
 * Phase 2C-22R: the common panel login admits exactly
 * SUPER_ADMIN/ADMIN/HEAD/MEMBER. Invalid credentials, inactive
 * accounts, and rate limits behave exactly as before (backend codes
 * surface unchanged); only the role gate moved from ADMIN-only to
 * panel-wide.
 */
describe('useAuthStore login role gate', () => {
  it.each([['SUPER_ADMIN'], ['ADMIN'], ['HEAD'], ['MEMBER']])('signs in %s and keeps the session', async (role) => {
    const user = { id: 'u1', email: 'staff@example.test', roles: [role] };
    loginRequest.mockResolvedValue({ user, accessToken: 'token' });

    const result = await useAuthStore.getState().login({ email: 'staff@example.test', password: 'Pass123!' });

    expect(result).toEqual({ ok: true });
    expect(useAuthStore.getState()).toMatchObject({ user, accessToken: 'token', status: 'ready', error: null });
    expect(logoutRequest).not.toHaveBeenCalled();
  });

  it('signs CUSTOMER straight back out with the stable NOT_ADMIN error', async () => {
    loginRequest.mockResolvedValue({
      user: { id: 'c1', email: 'c@example.test', roles: ['CUSTOMER'] },
      accessToken: 'token',
    });

    const result = await useAuthStore.getState().login({ email: 'c@example.test', password: 'Pass123!' });

    expect(result).toEqual({ ok: false });
    expect(logoutRequest).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      user: null,
      status: 'logged-out',
      error: { message: 'This account does not have admin access.', code: 'NOT_ADMIN' },
    });
  });

  it('signs unknown and roleless identities straight back out', async () => {
    for (const user of [{ id: 'u1', roles: ['OWNER'] }, { id: 'u1', roles: [] }, { id: 'u1' }]) {
      loginRequest.mockResolvedValue({ user, accessToken: 'token' });
      const result = await useAuthStore.getState().login({ email: 'x@example.test', password: 'Pass123!' });
      expect(result).toEqual({ ok: false });
      expect(useAuthStore.getState().status).toBe('logged-out');
    }
  });

  it('preserves invalid-credential and inactive behavior byte-for-byte', async () => {
    loginRequest.mockRejectedValueOnce({ message: 'Invalid email or password', code: 'AUTH_INVALID_CREDENTIALS' });
    await expect(
      useAuthStore.getState().login({ email: 'x@example.test', password: 'wrong' }),
    ).resolves.toEqual({ ok: false });
    expect(useAuthStore.getState()).toMatchObject({ status: 'logged-out', error: { code: 'AUTH_INVALID_CREDENTIALS' } });

    loginRequest.mockRejectedValueOnce({ message: 'Inactive', code: 'AUTH_ACCOUNT_INACTIVE' });
    await expect(
      useAuthStore.getState().login({ email: 'x@example.test', password: 'Pass123!' }),
    ).resolves.toEqual({ ok: false });
    expect(useAuthStore.getState().error).toMatchObject({ code: 'AUTH_ACCOUNT_INACTIVE' });
  });
});

describe('useAuthStore bootstrap role gate', () => {
  it.each([['SUPER_ADMIN'], ['HEAD'], ['MEMBER']])('keeps %s signed in on bootstrap', async (role) => {
    const user = { id: 'u1', email: 'staff@example.test', roles: [role] };
    fetchCurrentUser.mockResolvedValue(user);

    await useAuthStore.getState().bootstrap();

    expect(useAuthStore.getState()).toMatchObject({ user, status: 'ready' });
  });

  it('signs CUSTOMER out locally on bootstrap without touching their cookie session', async () => {
    fetchCurrentUser.mockResolvedValue({ id: 'c1', roles: ['CUSTOMER'] });

    await useAuthStore.getState().bootstrap();

    expect(useAuthStore.getState()).toMatchObject({ user: null, status: 'logged-out' });
    expect(logoutRequest).not.toHaveBeenCalled();
  });
});
