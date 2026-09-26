import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../ProtectedRoute.jsx';
import { useAuthStore } from '../../../stores/useAuthStore.js';

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

function renderGuard(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<p>Dashboard page</p>} />
        </Route>
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ accessToken: null, user: null, status: 'idle', error: null });
});

describe('admin ProtectedRoute bootstrap states', () => {
  it('waits with a loading gate while bootstrap is unresolved', () => {
    useAuthStore.setState({ status: 'loading' });
    renderGuard();
    expect(screen.getByRole('status', { name: 'Checking session' })).toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('renders the route for an authenticated admin', () => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: 'a1', roles: ['ADMIN'] },
      status: 'ready',
    });
    renderGuard();
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });

  it('redirects to login when settled logged-out', () => {
    useAuthStore.setState({ accessToken: null, user: null, status: 'logged-out', error: null });
    renderGuard();
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('shows a recoverable error panel — never a login redirect — on transient bootstrap failure', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      status: 'error',
      error: { message: 'Too many requests, please try again later.' },
    });
    // Phase 1: refresh still throttled — the mount-time bootstrap attempt
    // stays in the recoverable error state (no login redirect).
    let refreshMode = 'throttled';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init = {}) => {
        if (url.endsWith('/auth/refresh')) {
          if (refreshMode === 'throttled') {
            return jsonResponse(
              { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' } },
              { ok: false, status: 429 },
            );
          }
          return jsonResponse({ success: true, data: { accessToken: 'fresh' } });
        }
        if (url.endsWith('/auth/me')) {
          if (!init.headers?.Authorization) {
            return jsonResponse(
              { success: false, error: { code: 'AUTH_UNAUTHORIZED', message: 'Authentication required' } },
              { ok: false, status: 401 },
            );
          }
          return jsonResponse({ success: true, data: { user: { id: 'a1', roles: ['ADMIN'] } } });
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );
    renderGuard();

    expect(await screen.findByText('Couldn’t restore your session')).toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();

    // Phase 2: user retries after the throttle clears — session restored.
    refreshMode = 'ok';
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe('ready');
  });
});
