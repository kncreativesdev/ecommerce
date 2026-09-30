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
