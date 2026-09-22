import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CouponForm } from '../CouponForm.jsx';

function renderForm(props = {}) {
  return render(<CouponForm onSubmit={vi.fn()} products={[]} productsLoading={false} {...props} />);
}

describe('CouponForm submit control (Bug 2 regression)', () => {
  it('renders a real submit button so the form can post', () => {
    renderForm();
    const submit = screen.getByRole('button', { name: 'Create coupon' });
    expect(submit).toBeInTheDocument();
    // A form submit button must be type="submit": with type="button" the
    // click never fires a submit event and creation silently does nothing.
    expect(submit).toHaveAttribute('type', 'submit');
  });
});

describe('CouponForm create payload', () => {
  it('submits the documented body for valid input', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({});
    renderForm({ onSubmit });

    await user.type(screen.getByPlaceholderText('e.g. FESTIVE10'), 'new10');
    await user.type(screen.getByPlaceholderText('e.g. 10 or 200.00'), '10');
    await user.click(screen.getByRole('button', { name: 'Create coupon' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      code: 'new10',
      description: null,
      discountType: 'PERCENTAGE',
      discountValue: '10',
      minimumOrderAmount: null,
      maximumDiscountAmount: null,
      usageLimit: null,
      startsAt: null,
      expiresAt: null,
      isActive: true,
      productIds: [],
    });
  });

  it('blocks submit on empty code with a field error', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit });

    await user.type(screen.getByPlaceholderText('e.g. 10 or 200.00'), '10');
    await user.click(screen.getByRole('button', { name: 'Create coupon' }));

    expect(await screen.findByText('Code is required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects percentages above 100 without calling the service', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit });

    await user.type(screen.getByPlaceholderText('e.g. FESTIVE10'), 'BIG150');
    await user.type(screen.getByPlaceholderText('e.g. 10 or 200.00'), '150');
    await user.click(screen.getByRole('button', { name: 'Create coupon' }));

    expect(await screen.findByText('Percentage discount must be at most 100.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('maps a duplicate-code backend failure onto the code field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({ code: 'COUPON_CODE_EXISTS', details: [] });
    renderForm({ onSubmit });

    await user.type(screen.getByPlaceholderText('e.g. FESTIVE10'), 'TAKEN');
    await user.type(screen.getByPlaceholderText('e.g. 10 or 200.00'), '10');
    await user.click(screen.getByRole('button', { name: 'Create coupon' }));

    expect(await screen.findByText('This code is already taken.')).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
