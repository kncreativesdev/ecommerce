import { create } from 'zustand';

/**
 * Ephemeral checkout UI state — never persisted (FRONTEND_ARCHITECTURE §6):
 * current step, selected shipping/billing address ids, billing-same flag,
 * and the applied coupon quote. Reset on order success. Totals always
 * render from server responses.
 *
 * `appliedCoupon` holds the AUTHORITATIVE `POST /coupons/validate`
 * response (`{ coupon, discountAmount, eligibleSubtotal, orderSubtotal }`)
 * for the CURRENT cart. It is a preview, not order truth: placement
 * re-validates server-side (a changed cart may invalidate it — the
 * backend error is then surfaced and the quote stays until removed or
 * re-applied).
 */
export const useCheckoutStore = create((set) => ({
  step: 1,
  shippingAddressId: null,
  billingAddressId: null,
  billingSameAsShipping: true,
  placingOrder: false,
  lastError: null,
  appliedCoupon: null,

  setStep: (step) => set({ step }),
  setShippingAddressId: (shippingAddressId) => set({ shippingAddressId }),
  setBillingAddressId: (billingAddressId) => set({ billingAddressId }),
  setBillingSameAsShipping: (billingSameAsShipping) =>
    set({ billingSameAsShipping, ...(billingSameAsShipping ? { billingAddressId: null } : {}) }),
  setPlacingOrder: (placingOrder) => set({ placingOrder }),
  setLastError: (lastError) => set({ lastError }),
  setAppliedCoupon: (appliedCoupon) => set({ appliedCoupon }),
  clearAppliedCoupon: () => set({ appliedCoupon: null }),

  reset: () =>
    set({
      step: 1,
      shippingAddressId: null,
      billingAddressId: null,
      billingSameAsShipping: true,
      placingOrder: false,
      lastError: null,
      appliedCoupon: null,
    }),
}));
