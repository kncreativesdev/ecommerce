import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryForm } from '../CategoryForm.jsx';
import { useAuthStore } from '../../../stores/useAuthStore.js';

function renderForm(props = {}) {
  return render(<CategoryForm categories={[]} onSubmit={vi.fn()} {...props} />);
}

describe('CategoryForm Active toggle role gating', () => {
  it('shows the Active toggle to ADMIN', () => {
    useAuthStore.setState({ user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] } });
    renderForm();
    expect(screen.getByRole('checkbox', { name: 'Active (visible in storefront)' })).toBeInTheDocument();
  });

  it('hides the Active toggle for HEAD (create still defaults active)', async () => {
    useAuthStore.setState({ user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] } });
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    expect(screen.queryByRole('checkbox', { name: 'Active (visible in storefront)' })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('e.g. Car Chargers'), 'Chargers');
    await user.click(screen.getByRole('button', { name: 'Create category' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }), null);
  });
});
