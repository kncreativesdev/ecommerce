import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../ProtectedRoute.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { fetchNotifications, fetchUnreadCount } from '../../services/notifications.service.js';

vi.mock('../../services/notifications.service.js', () => ({
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock('../../services/marketing.service.js', () => ({
  fetchActiveMarketing: vi.fn().mockResolvedValue([]),
  resolveMarketingHref: () => null,
}));

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

function renderGuard(initialPath = '/account/orders') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/account/orders" element={<p>Orders page</p>} />
        </Route>
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ accessToken: null, user: null, status: 'idle', lastError: null });
  fetchNotifications.mockResolvedValue([]);
  fetchUnreadCount.mockResolvedValue(0);
});

describe('ProtectedRoute bootstrap states', () => {
  it('waits with a loading gate while bootstrap is unresolved', () => {
    useAuthStore.setState({ status: 'loading' });
    renderGuard();
    expect(screen.getByRole('status', { name: 'Checking session' })).toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('renders the route when authenticated', () => {
    useAuthStore.setState({ accessToken: 't', user: { id: 'u1' }, status: 'ready' });
    renderGuard();
    expect(screen.getByText('Orders page')).toBeInTheDocument();
  });

  it('redirects to login only when settled anonymous', () => {
    useAuthStore.setState({ accessToken: null, user: null, status: 'ready', lastError: null });
    renderGuard();
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('shows a recoverable error panel — never a login redirect — on transient bootstrap failure', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      status: 'error',
      lastError: { message: 'Too many requests, please try again later.' },
    });
    // Retry restores the session through one shared refresh.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url.endsWith('/auth/refresh')) return jsonResponse({ success: true, data: { accessToken: 'fresh' } });
        if (url.endsWith('/auth/me')) return jsonResponse({ success: true, data: { user: { id: 'u1' } } });
        return jsonResponse({ success: true, data: [] });
      }),
    );
    renderGuard();

    expect(await screen.findByText('Couldn’t restore your session')).toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText('Orders page')).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe('ready');
  });
});
