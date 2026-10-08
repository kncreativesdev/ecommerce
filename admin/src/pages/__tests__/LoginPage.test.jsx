import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../LoginPage.jsx';
import { landingFor } from '../../lib/loginLanding.js';
import { useAuthStore } from '../../stores/useAuthStore.js';

vi.mock('../../stores/useAuthStore.js', () => ({
  useAuthStore: vi.fn(),
}));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<div>Dashboard home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.mockImplementation((selector) => selector({
    login: vi.fn(),
    status: 'idle',
    user: null,
  }));
});

describe('landingFor role-aware landing target', () => {
  it('sends ADMIN to the validated redirect (default dashboard)', () => {
    expect(landingFor({ roles: ['ADMIN'] }, null)).toBe('/dashboard');
    expect(landingFor({ roles: ['ADMIN'] }, '/orders')).toBe('/orders');
  });

  it('rejects external redirect targets for ADMIN', () => {
    expect(landingFor({ roles: ['ADMIN'] }, '//evil.test')).toBe('/dashboard');
    expect(landingFor({ roles: ['ADMIN'] }, 'https://evil.test')).toBe('/dashboard');
  });

  it.each([['HEAD'], ['MEMBER']])('sends %s to audit-logs (redirect ignored)', (role) => {
    expect(landingFor({ roles: [role] }, null)).toBe('/audit-logs');
    expect(landingFor({ roles: [role] }, '/dashboard')).toBe('/audit-logs');
  });

  it('sends SUPER_ADMIN to the dedicated platform dashboard (redirect ignored)', () => {
    expect(landingFor({ roles: ['SUPER_ADMIN'] }, null)).toBe('/platform');
    expect(landingFor({ roles: ['SUPER_ADMIN'] }, '/dashboard')).toBe('/platform');
  });

  it('sends roleless/unknown users to audit-logs (guard bounces them)', () => {
    expect(landingFor(null, null)).toBe('/audit-logs');
    expect(landingFor({ roles: ['CUSTOMER'] }, null)).toBe('/audit-logs');
  });
});

describe('Admin LoginPage post-login landing (no stale closure)', () => {
  let currentUser;

  function renderLoginAt(path) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<div>Dashboard home</div>} />
          <Route path="/audit-logs" element={<div>Audit logs home</div>} />
          <Route path="/orders" element={<div>Orders home</div>} />
          <Route path="/platform" element={<div>Platform home</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  async function submitLoginAs(roles, path = '/login') {
    const user = userEvent.setup();
    currentUser = null;
    const login = vi.fn(async () => {
      currentUser = { id: 'u1', email: 'staff@example.test', roles };
      return { ok: true };
    });
    useAuthStore.mockImplementation((selector) => selector({
      login,
      status: 'ready',
      user: currentUser,
    }));
    useAuthStore.getState = () => ({ user: currentUser });
    renderLoginAt(path);
    await user.type(await screen.findByPlaceholderText('admin@example.com'), 'staff@example.test');
    await user.type(screen.getByPlaceholderText('••••••••'), 'StaffPass123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).toHaveBeenCalledTimes(1);
  }

  it('lands ADMIN on the dashboard after form submit (not audit-logs)', async () => {
    await submitLoginAs(['ADMIN']);
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
    expect(screen.queryByText('Audit logs home')).not.toBeInTheDocument();
  });

  it('honors a validated redirect target for ADMIN after submit', async () => {
    await submitLoginAs(['ADMIN'], '/login?redirect=/orders');
    expect(await screen.findByText('Orders home')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard home')).not.toBeInTheDocument();
  });

  it.each([['HEAD'], ['MEMBER']])('lands %s on audit-logs after submit', async (role) => {
    await submitLoginAs([role]);
    expect(await screen.findByText('Audit logs home')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard home')).not.toBeInTheDocument();
  });

  it('lands SUPER_ADMIN on the dedicated platform dashboard after submit', async () => {
    await submitLoginAs(['SUPER_ADMIN']);
    expect(await screen.findByText('Platform home')).toBeInTheDocument();
    expect(screen.queryByText('Audit logs home')).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard home')).not.toBeInTheDocument();
  });
});

describe('Admin LoginPage password visibility', () => {
  it('starts with the password hidden', async () => {
    renderLogin();
    const field = await screen.findByPlaceholderText('••••••••');
    expect(field).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles the password field between hidden and visible', async () => {
    const user = userEvent.setup();
    renderLogin();
    const field = await screen.findByPlaceholderText('••••••••');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(field).toHaveAttribute('type', 'password');
  });

  it('keeps the typed password value intact when toggling', async () => {
    const user = userEvent.setup();
    renderLogin();
    const field = await screen.findByPlaceholderText('••••••••');

    await user.type(field, 'AdminPass123!');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveValue('AdminPass123!');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(field).toHaveValue('AdminPass123!');
  });

  it('does not submit the form when the eye button is clicked', async () => {
    const user = userEvent.setup();
    const login = vi.fn();
    useAuthStore.mockImplementation((selector) => selector({
      login,
      status: 'idle',
      user: null,
    }));
    renderLogin();
    await screen.findByPlaceholderText('••••••••');

    await user.click(screen.getByRole('button', { name: 'Show password' }));

    expect(login).not.toHaveBeenCalled();
    expect(screen.queryByText('Dashboard home')).not.toBeInTheDocument();
  });
});
