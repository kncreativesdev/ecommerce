import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CouponSection } from '../CouponSection.jsx';
import { useCartStore } from '../../../stores/useCartStore.js';
import { useCheckoutStore } from '../../../stores/useCheckoutStore.js';
import { validateCoupon } from '../../../services/coupons.service.js';

vi.mock('../../../services/coupons.service.js', () => ({
  validateCoupon: vi.fn(),
}));

const CART = { items: [{ id: 'line-1' }], itemCount: 1, subtotal: '200.00' };

function quoteFixture(code = 'SAVE10') {
  return {
    coupon: { code },
    discountAmount: '20.00',
    eligibleSubtotal: '200.00',
    orderSubtotal: '200.00',
  };
}

function alreadyUsedError() {
  return { code: 'COUPON_ALREADY_USED', status: 409, message: 'You have already used this coupon.' };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({ cart: CART });
  useCheckoutStore.setState({ appliedCoupon: null, placingOrder: false });
});

describe('CouponSection already-used coupon', () => {
  it('applies a valid coupon normally', async () => {
    const user = userEvent.setup();
    validateCoupon.mockResolvedValue(quoteFixture());
    render(<CouponSection />);

    await user.type(screen.getByLabelText('Coupon code'), 'SAVE10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('SAVE10')).toBeInTheDocument();
    expect(useCheckoutStore.getState().appliedCoupon.coupon.code).toBe('SAVE10');
  });

  it('displays the already-used error without applying', async () => {
    const user = userEvent.setup();
    validateCoupon.mockRejectedValue(alreadyUsedError());
    render(<CouponSection />);

    await user.type(screen.getByLabelText('Coupon code'), 'USED10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You have already used this coupon.');
    // Not applied: no Applied state, form still present.
    expect(screen.queryByText('Applied:')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Coupon code')).toBeInTheDocument();
    expect(useCheckoutStore.getState().appliedCoupon).toBeNull();
  });

  it('shows no discount after rejection', async () => {
    const user = userEvent.setup();
    validateCoupon.mockRejectedValue(alreadyUsedError());
    render(<CouponSection />);

    await user.type(screen.getByLabelText('Coupon code'), 'USED10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByRole('alert');

    expect(screen.queryByText(/20\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Estimated total/)).not.toBeInTheDocument();
  });

  it('keeps cart and checkout state intact after rejection', async () => {
    const user = userEvent.setup();
    validateCoupon.mockRejectedValue(alreadyUsedError());
    render(<CouponSection />);

    await user.type(screen.getByLabelText('Coupon code'), 'USED10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByRole('alert');

    expect(useCartStore.getState().cart).toEqual(CART);
    expect(useCheckoutStore.getState().appliedCoupon).toBeNull();
  });

  it('lets the customer replace the rejected coupon with a valid one', async () => {
    const user = userEvent.setup();
    validateCoupon.mockRejectedValueOnce(alreadyUsedError());
    validateCoupon.mockResolvedValueOnce(quoteFixture('FRESH10'));
    render(<CouponSection />);

    await user.type(screen.getByLabelText('Coupon code'), 'USED10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You have already used this coupon.');

    await user.clear(screen.getByLabelText('Coupon code'));
    await user.type(screen.getByLabelText('Coupon code'), 'FRESH10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('FRESH10')).toBeInTheDocument();
    expect(useCheckoutStore.getState().appliedCoupon.coupon.code).toBe('FRESH10');
  });

  it('keeps removal working after a successful apply', async () => {
    const user = userEvent.setup();
    validateCoupon.mockResolvedValue(quoteFixture());
    render(<CouponSection />);

    await user.type(screen.getByLabelText('Coupon code'), 'SAVE10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove coupon SAVE10' }));
    expect(screen.getByLabelText('Coupon code')).toBeInTheDocument();
    expect(useCheckoutStore.getState().appliedCoupon).toBeNull();
  });
});
