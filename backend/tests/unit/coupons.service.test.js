import { describe, it, expect } from "vitest";
import { calculateDiscountAmount, applyDiscountCap } from "../../src/modules/coupons/coupons.service.js";

/**
 * Pure discount-math unit tests. These helpers take plain coupon literals
 * and BigInt cents — no repository, no database, no side effects — so
 * they run deterministically without MySQL. The numbers mirror the exact
 * semantics `validateCouponForOrder` applies at checkout.
 */
function coupon(overrides = {}) {
  return {
    discountType: "PERCENTAGE",
    discountValue: "10.00",
    maximumDiscountAmount: null,
    ...overrides,
  };
}

describe("calculateDiscountAmount", () => {
  it("computes a percentage of the eligible subtotal", () => {
    expect(calculateDiscountAmount(coupon(), 10000n)).toBe(1000n);
  });

  it("rounds half-up to the cent", () => {
    // 10% of 33.33 → 3.333 → 3.33.
    expect(calculateDiscountAmount(coupon(), 3333n)).toBe(333n);
    // 12.50% of 100.00 → exactly 12.50.
    expect(calculateDiscountAmount(coupon({ discountValue: "12.50" }), 10000n)).toBe(1250n);
  });

  it("accepts a 100% percentage but rejects 0 and anything above 100", () => {
    expect(calculateDiscountAmount(coupon({ discountValue: "100.00" }), 10000n)).toBe(10000n);
    expect(() => calculateDiscountAmount(coupon({ discountValue: "0.00" }), 10000n)).toThrow(
      expect.objectContaining({ code: "COUPON_INVALID_DISCOUNT" })
    );
    expect(() => calculateDiscountAmount(coupon({ discountValue: "100.01" }), 10000n)).toThrow(
      expect.objectContaining({ code: "COUPON_INVALID_DISCOUNT" })
    );
  });

  it("caps a fixed discount at the eligible subtotal and rejects non-positive values", () => {
    expect(calculateDiscountAmount(coupon({ discountType: "FIXED", discountValue: "500.00" }), 10000n)).toBe(
      10000n
    );
    expect(calculateDiscountAmount(coupon({ discountType: "FIXED", discountValue: "25.00" }), 10000n)).toBe(
      2500n
    );
    expect(() =>
      calculateDiscountAmount(coupon({ discountType: "FIXED", discountValue: "0.00" }), 10000n)
    ).toThrow(expect.objectContaining({ code: "COUPON_INVALID_DISCOUNT" }));
  });

  it("rejects unsupported discount types", () => {
    expect(() => calculateDiscountAmount(coupon({ discountType: "BOGO" }), 10000n)).toThrow(
      expect.objectContaining({ code: "COUPON_INVALID_DISCOUNT" })
    );
  });
});

describe("applyDiscountCap", () => {
  it("returns the amount unchanged without a cap", () => {
    expect(applyDiscountCap(coupon(), 2500n)).toBe(2500n);
  });

  it("clamps to the maximum discount amount", () => {
    expect(applyDiscountCap(coupon({ maximumDiscountAmount: "10.00" }), 2500n)).toBe(1000n);
    expect(applyDiscountCap(coupon({ maximumDiscountAmount: "100.00" }), 2500n)).toBe(2500n);
  });
});
