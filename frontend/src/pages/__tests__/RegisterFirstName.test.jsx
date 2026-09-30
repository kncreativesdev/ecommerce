import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RegisterPage } from '../RegisterPage.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';

vi.mock('../../stores/useAuthStore.js', () => ({
  useAuthStore: vi.fn(),
}));

function renderRegister(mockImpl) {
  useAuthStore.mockImplementation((selector) => selector({
    registerThenLogin: mockImpl,
    accessToken: null,
    status: 'ready',
  }));
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/account" element={<div>Account home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillValidExcept(user, { firstName }) {
  await user.type(screen.getByPlaceholderText('you@example.com'), 'aarav@example.com');
  await user.type(screen.getByPlaceholderText('Choose a strong password'), 'TestPass123!');
  if (firstName !== undefined) {
    await user.type(screen.getByPlaceholderText('Your first name'), firstName);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RegisterPage mandatory first name', () => {
  it('marks First Name as visibly required', async () => {
    const registerThenLogin = vi.fn().mockResolvedValue({ ok: false, error: { message: 'nope' } });
    renderRegister(registerThenLogin);
    await screen.findByRole('button', { name: 'Create account' });

    // FormField renders a required asterisk next to required labels.
    const label = screen.getByText('First name', { exact: false });
    expect(label.textContent).toContain('*');
    expect(screen.getByPlaceholderText('Your first name')).toBeInTheDocument();
  });

  it('rejects an empty first name without submitting', async () => {
    const user = userEvent.setup();
    const registerThenLogin = vi.fn().mockResolvedValue({ ok: false, error: { message: 'nope' } });
    renderRegister(registerThenLogin);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'aarav@example.com');
    await user.type(screen.getByPlaceholderText('Choose a strong password'), 'TestPass123!');
    // First name left empty.
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('First name is required.')).toBeInTheDocument();
    expect(registerThenLogin).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only first name without submitting', async () => {
    const user = userEvent.setup();
    const registerThenLogin = vi.fn().mockResolvedValue({ ok: false, error: { message: 'nope' } });
    renderRegister(registerThenLogin);

    await fillValidExcept(user, { firstName: '   ' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('First name is required.')).toBeInTheDocument();
    expect(registerThenLogin).not.toHaveBeenCalled();
  });

  it('normalizes valid input and includes it in the request payload', async () => {
    const user = userEvent.setup();
    const registerThenLogin = vi.fn().mockResolvedValue({ ok: true });
    renderRegister(registerThenLogin);

    await fillValidExcept(user, { firstName: '  Aarav  ' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(registerThenLogin).toHaveBeenCalledTimes(1));
    // Zod trims before RHF hands values to the submit handler.
    expect(registerThenLogin).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Aarav', email: 'aarav@example.com' }),
    );
  });

  it('displays backend first-name validation errors on the field', async () => {
    const user = userEvent.setup();
    const registerThenLogin = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        status: 422,
        message: 'Invalid request data',
        details: [{ path: 'firstName', message: 'First name is required.' }],
      },
    });
    renderRegister(registerThenLogin);

    await fillValidExcept(user, { firstName: 'Aarav' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    // Server-mapped field error appears (applyServerErrors → setError).
    expect(await screen.findByText('First name is required.')).toBeInTheDocument();
  });

  it('keeps other-field validation intact', async () => {
    const user = userEvent.setup();
    const registerThenLogin = vi.fn().mockResolvedValue({ ok: false, error: { message: 'nope' } });
    renderRegister(registerThenLogin);

    // Invalid email + short password + valid first name → email/password
    // errors, no submission.
    await user.type(screen.getByPlaceholderText('you@example.com'), 'not-an-email');
    await user.type(screen.getByPlaceholderText('Choose a strong password'), 'short');
    await user.type(screen.getByPlaceholderText('Your first name'), 'Aarav');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(registerThenLogin).not.toHaveBeenCalled();
  });
});
