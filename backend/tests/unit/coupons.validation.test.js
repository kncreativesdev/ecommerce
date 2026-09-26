import { describe, it, expect } from "vitest";
import {
  normalizeCouponCode,
  createCouponSchema,
  updateCouponSchema,
  adminCouponListQuerySchema,
} from "../../src/modules/coupons/coupons.validation.js";

describe("normalizeCouponCode", () => {
  it("trims and uppercases codes", () => {
    expect(normalizeCouponCode("  save10 ")).toBe("SAVE10");
  });
});

describe("createCouponSchema", () => {
  it("accepts a minimal valid definition", () => {
    const parsed = createCouponSchema.parse({
      code: "SAVE10",
      discountType: "PERCENTAGE",
      discountValue: "10",
    });
    expect(parsed.code).toBe("SAVE10");
    expect(parsed.discountType).toBe("PERCENTAGE");
  });

  it("rejects server-managed and unknown fields (strict body)", () => {
    expect(() =>
      createCouponSchema.parse({
        code: "SAVE10",
        discountType: "FIXED",
        discountValue: "50",
        usedCount: 3,
      })
    ).toThrow();
    expect(() =>
      createCouponSchema.parse({
        code: "SAVE10",
        discountType: "FIXED",
        discountValue: "50",
        perCustomerLimit: 1,
      })
    ).toThrow();
  });

  it("rejects overlong codes and unknown discount types", () => {
    expect(() =>
      createCouponSchema.parse({ code: "X".repeat(51), discountType: "FIXED", discountValue: "5" })
    ).toThrow();
    expect(() =>
      createCouponSchema.parse({ code: "SAVE10", discountType: "BOGO", discountValue: "5" })
    ).toThrow();
  });
});

describe("updateCouponSchema", () => {
  it("accepts a partial lifecycle toggle", () => {
    expect(updateCouponSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it("rejects unknown fields", () => {
    expect(() => updateCouponSchema.parse({ isActive: true, usedCount: 0 })).toThrow();
  });
});

describe("adminCouponListQuerySchema", () => {
  it("coerces page/limit, trims search, defaults nothing", () => {
    expect(
      adminCouponListQuerySchema.parse({ page: "2", limit: "10", status: "active", search: " save " })
    ).toEqual({ page: 2, limit: 10, status: "active", search: "save" });
  });

  it("strips unknown params instead of rejecting the list", () => {
    expect(adminCouponListQuerySchema.parse({ page: "1", sortBy: "code" })).toEqual({ page: 1 });
  });

  it("rejects invalid status values", () => {
    expect(() => adminCouponListQuerySchema.parse({ status: "expired" })).toThrow();
  });
});
