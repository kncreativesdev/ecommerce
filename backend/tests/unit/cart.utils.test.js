import { describe, it, expect } from "vitest";

import { toSafeCartItem } from "../../src/modules/cart/cart.utils.js";

/**
 * Server-side variant display-image priority (mirrors the documented
 * storefront rule): variant primary → variant first (sortOrder asc) →
 * product primary → product first → null. Historical cart lines and order
 * snapshots both derive from this order.
 */

function lineFixture(variantImages, productImages) {
  return {
    id: "line-1",
    variantId: "v-a",
    quantity: 2,
    variant: {
      id: "v-a",
      sku: "SKU-A",
      name: "Black",
      price: "100.00",
      isActive: true,
      images: variantImages,
      product: {
        id: "p-1",
        name: "Shirt",
        slug: "shirt",
        isActive: true,
        images: productImages,
      },
    },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

const img = (overrides) => ({
  storagePath: "products/p/a.webp",
  altText: null,
  sortOrder: 0,
  isPrimary: false,
  ...overrides,
});

describe("toSafeCartItem display image priority", () => {
  it("prefers the variant primary image over product-level media", () => {
    const item = toSafeCartItem(
      lineFixture(
        [img({ storagePath: "products/p/a2.webp", sortOrder: 1 }), img({ storagePath: "products/p/a1.webp", sortOrder: 0, isPrimary: true })],
        [img({ storagePath: "products/p/hero.webp", isPrimary: true })]
      )
    );
    expect(item.image).toMatchObject({ storagePath: "products/p/a1.webp" });
    expect(item.variantId).toBe("v-a");
    expect(item.variant.sku).toBe("SKU-A");
  });

  it("uses the first ordered variant image when no primary exists", () => {
    const item = toSafeCartItem(
      lineFixture(
        [img({ storagePath: "products/p/a2.webp", sortOrder: 1 }), img({ storagePath: "products/p/a1.webp", sortOrder: 0 })],
        [img({ storagePath: "products/p/hero.webp", isPrimary: true })]
      )
    );
    expect(item.image).toMatchObject({ storagePath: "products/p/a1.webp" });
  });

  it("falls back to the product-level primary image for imageless variants (legacy)", () => {
    const item = toSafeCartItem(
      lineFixture([], [img({ storagePath: "products/p/hero.webp", isPrimary: true }), img({ storagePath: "products/p/alt.webp", sortOrder: 5 })])
    );
    expect(item.image).toMatchObject({ storagePath: "products/p/hero.webp" });
  });

  it("falls back to the first product-level image when no primary exists anywhere", () => {
    const item = toSafeCartItem(
      lineFixture([], [img({ storagePath: "products/p/b.webp", sortOrder: 3 }), img({ storagePath: "products/p/a.webp", sortOrder: 1 })])
    );
    expect(item.image).toMatchObject({ storagePath: "products/p/a.webp" });
  });

  it("resolves null when no images exist (legacy-compatible)", () => {
    const item = toSafeCartItem(lineFixture([], []));
    expect(item.image).toBeNull();
  });
});
