import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../LoginPage.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';

vi.mock('../../stores/useAuthStore.js', () => ({
  useAuthStore: vi.fn(),
}));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/account" element={<div>Account home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.mockImplementation((selector) => selector({
    login: vi.fn().mockResolvedValue({ ok: false, error: { message: 'nope' } }),
    accessToken: null,
    status: 'ready',
  }));
});

describe('LoginPage password visibility', () => {
  it('toggles the password field between hidden and visible', async () => {
    const user = userEvent.setup();
    renderLogin();
    const field = await screen.findByPlaceholderText('Your password');
    expect(field).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(field).toHaveAttribute('type', 'password');
  });
});

describe('LoginPage company suspension (Phase F1)', () => {
  async function submitAs(email, password, login) {
    const user = userEvent.setup();
    useAuthStore.mockImplementation((selector) => selector({
      login,
      accessToken: null,
      status: 'ready',
    }));
    renderLogin();
    await user.type(await screen.findByPlaceholderText('you@example.com'), email);
    await user.type(screen.getByPlaceholderText('Your password'), password);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
  }

  it('shows the dedicated suspension message for 403 COMPANY_SUSPENDED', async () => {
    const login = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'COMPANY_SUSPENDED', status: 403, message: 'Company operations are unavailable while the company is suspended' },
    });
    await submitAs('buyer@example.test', 'password123', login);

    expect(await screen.findByRole('alert')).toHaveTextContent(/currently unavailable.*suspended.*signing in again will not restore access/i);
    expect(screen.queryByText(/incorrect email or password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/account is disabled/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/COMPANY_SUSPENDED/)).not.toBeInTheDocument();
  });

  it('keeps invalid credentials on the existing invalid-credential message', async () => {
    const login = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'AUTH_INVALID_CREDENTIALS', status: 401, message: 'Invalid email or password' },
    });
    await submitAs('buyer@example.test', 'wrongpassword', login);

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect email or password/i);
  });

  it('keeps an ordinary 403 on the existing disabled-account message', async () => {
    const login = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'AUTH_ACCOUNT_INACTIVE', status: 403, message: 'Account is inactive' },
    });
    await submitAs('buyer@example.test', 'password123', login);

    expect(await screen.findByRole('alert')).toHaveTextContent(/account is disabled/i);
  });
});

describe('LoginPage Google sign-in (temporarily hidden)', () => {
  it('does not display any Google authentication option', async () => {
    renderLogin();
    await screen.findByRole('button', { name: 'Sign in' });

    // No Google button, no Google-specific separator — the underlying
    // Google implementation stays intact for re-enablement.
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    expect(screen.queryByText('Continue with Google')).not.toBeInTheDocument();
  });

  it('keeps the normal email/password UI unchanged', async () => {
    renderLogin();
    expect(await screen.findByPlaceholderText('you@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
  });
});
