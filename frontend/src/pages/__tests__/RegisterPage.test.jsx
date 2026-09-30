import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RegisterPage } from '../RegisterPage.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';

vi.mock('../../stores/useAuthStore.js', () => ({
  useAuthStore: vi.fn(),
}));

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/account" element={<div>Account home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.mockImplementation((selector) => selector({
    registerThenLogin: vi.fn().mockResolvedValue({ ok: false, error: { message: 'nope' } }),
    accessToken: null,
    status: 'ready',
  }));
});

describe('RegisterPage password visibility', () => {
  it('toggles the password field between hidden and visible', async () => {
    const user = userEvent.setup();
    renderRegister();
    const field = await screen.findByPlaceholderText('Choose a strong password');
    expect(field).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(field).toHaveAttribute('type', 'password');
  });
});

describe('RegisterPage Google sign-up (temporarily hidden)', () => {
  it('does not display any Google authentication option', async () => {
    renderRegister();
    await screen.findByRole('button', { name: 'Create account' });

    // No Google button, no Google-specific separator — the underlying
    // Google implementation stays intact for re-enablement.
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    expect(screen.queryByText('Continue with Google')).not.toBeInTheDocument();
  });

  it('keeps the normal registration UI unchanged', async () => {
    renderRegister();
    expect(await screen.findByPlaceholderText('you@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Choose a strong password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
  });
});
