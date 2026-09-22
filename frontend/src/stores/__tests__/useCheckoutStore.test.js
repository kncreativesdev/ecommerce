import { beforeEach, describe, expect, it } from 'vitest';
import { useCheckoutStore } from '../useCheckoutStore.js';

const quote = {
  coupon: { code: 'SAVE10' },
  discountAmount: '20.00',
  eligibleSubtotal: '200.00',
  orderSubtotal: '200.00',
};

beforeEach(() => {
  useCheckoutStore.getState().reset();
});

describe('useCheckoutStore applied coupon', () => {
  it('stores and clears the authoritative quote', () => {
    expect(useCheckoutStore.getState().appliedCoupon).toBeNull();

    useCheckoutStore.getState().setAppliedCoupon(quote);
    expect(useCheckoutStore.getState().appliedCoupon).toEqual(quote);

    useCheckoutStore.getState().clearAppliedCoupon();
    expect(useCheckoutStore.getState().appliedCoupon).toBeNull();
  });

  it('reset clears the coupon alongside the rest of checkout state', () => {
    useCheckoutStore.setState({ appliedCoupon: quote, step: 3, shippingAddressId: 'ship-1' });

    useCheckoutStore.getState().reset();

    const state = useCheckoutStore.getState();
    expect(state.appliedCoupon).toBeNull();
    expect(state.step).toBe(1);
    expect(state.shippingAddressId).toBeNull();
  });
});
