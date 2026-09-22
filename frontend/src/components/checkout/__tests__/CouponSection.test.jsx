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

function quoteFixture() {
  return {
    coupon: { code: 'SAVE10' },
    discountAmount: '20.00',
    eligibleSubtotal: '200.00',
    orderSubtotal: '200.00',
  };
}

function resetStores() {
  useCartStore.setState({ cart: { items: [{ id: 'line-1' }], itemCount: 1, subtotal: '200.00' } });
  useCheckoutStore.setState({ appliedCoupon: null, placingOrder: false });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStores();
});

describe('CouponSection', () => {
  it('renders the coupon input with an accessible label', () => {
    render(<CouponSection />);
    expect(screen.getByRole('heading', { name: 'Coupon' })).toBeInTheDocument();
    expect(screen.getByLabelText('Coupon code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('applies a valid coupon and shows the server-returned discount', async () => {
    const user = userEvent.setup();
    validateCoupon.mockResolvedValue(quoteFixture());
    render(<CouponSection />);

    await user.type(screen.getByLabelText('Coupon code'), 'save10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(validateCoupon).toHaveBeenCalledWith('save10');
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();
    expect(screen.getByText(/20\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove coupon SAVE10' })).toBeInTheDocument();
    // Estimated total is display-only subtraction of two server values.
    expect(screen.getByText(/180\.00/)).toBeInTheDocument();
    expect(useCheckoutStore.getState().appliedCoupon.coupon.code).toBe('SAVE10');
  });

  it('disables Apply while validating so no duplicate request fires', async () => {
    const user = userEvent.setup();
    const gate = deferred();
    validateCoupon.mockReturnValue(gate.promise);
    render(<CouponSection />);

    await user.type(screen.getByLabelText('Coupon code'), 'SAVE10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    const applying = await screen.findByRole('button', { name: 'Applying…' });
    expect(applying).toBeDisabled();
    expect(validateCoupon).toHaveBeenCalledTimes(1);

    gate.resolve(quoteFixture());
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();
    expect(validateCoupon).toHaveBeenCalledTimes(1);
  });

  it('surfaces backend validation failures without applying', async () => {
    const user = userEvent.setup();
    validateCoupon.mockRejectedValue({ code: 'COUPON_EXPIRED', message: 'Coupon has expired' });
    render(<CouponSection />);

    await user.type(screen.getByLabelText('Coupon code'), 'OLD');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Coupon has expired');
    expect(screen.queryByText('OLD')).not.toBeInTheDocument();
    expect(useCheckoutStore.getState().appliedCoupon).toBeNull();
  });

  it('removes an applied coupon', async () => {
    const user = userEvent.setup();
    useCheckoutStore.setState({ appliedCoupon: quoteFixture() });
    render(<CouponSection />);
    expect(screen.getByText('SAVE10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove coupon SAVE10' }));

    expect(screen.getByLabelText('Coupon code')).toBeInTheDocument();
    expect(useCheckoutStore.getState().appliedCoupon).toBeNull();
  });
});
