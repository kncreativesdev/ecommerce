import { discountPercentFromStrings } from '../lib/format.js';

/**
 * Product adapter: the single boundary between backend product payloads
 * (verified shape in `backend/src/modules/products/products.utils.js`
 * `toSafeProduct`/`toSafeVariant`) and the internal presentation model
 * consumed by ProductCard, ProductGrid, ShopPage, and ProductDetailPage.
 *
 * Internal product shape mirrors the backend 1:1 — no fields are invented:
 * `{ id, categoryId, category, name, slug, description, shortDescription,
 *    brand, isActive, isFeatured, variants, createdAt, updatedAt }`.
 * Notably ABSENT (never fabricated): ratings, review counts, stock
 * quantities, popularity scores, embedded images (product payloads carry
 * none — images resolve via `GET /products/:productId/images` in the media
 * milestone, GAP-07).
 *
 * Pure selectors below derive ONLY what the backend supports:
 * - default purchasable variant (first active variant — variants are the
 *   purchasable unit per FRONTEND_SPEC §7),
 * - discount % from variant `price` vs `compareAtPrice` (both verified
 *   decimal strings; `null` when no MRP claim exists),
 * - merchandising derivations over a loaded dataset (`isFeatured`,
 *   `createdAt` — the only supported signals; no popularity invention).
 */

/** Normalize one backend product record (defensive copy, same fields). */
export function adaptProduct(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    id: record.id ?? null,
    categoryId: record.categoryId ?? null,
    category: record.category
      ? {
          id: record.category.id ?? null,
          name: record.category.name ?? '',
          slug: record.category.slug ?? '',
        }
      : null,
    name: record.name ?? '',
    slug: record.slug ?? '',
    description: record.description ?? null,
    shortDescription: record.shortDescription ?? null,
    brand: record.brand ?? null,
    isActive: record.isActive ?? true,
    isFeatured: record.isFeatured ?? false,
    variants: Array.isArray(record.variants)
      ? record.variants.map((variant) => ({
          id: variant.id ?? null,
          productId: variant.productId ?? record.id ?? null,
          sku: variant.sku ?? null,
          name: variant.name ?? '',
          price: variant.price ?? null,
          compareAtPrice: variant.compareAtPrice ?? null,
          barcode: variant.barcode ?? null,
          weight: variant.weight ?? null,
          isActive: variant.isActive ?? true,
          // Backend inventory truth: boolean availability per variant.
          // Absent (legacy/admin payloads) means unknown — never invented.
          ...(variant.inStock !== undefined ? { inStock: Boolean(variant.inStock) } : {}),
          createdAt: variant.createdAt ?? null,
          updatedAt: variant.updatedAt ?? null,
        }))
      : [],
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
  };
}

/** Normalize a `GET /products` bare array (drops unusable rows). */
export function adaptProductList(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.map(adaptProduct).filter((product) => product && product.id);
}

/** Active variants of a product, in backend order. */
export function getActiveVariants(product) {
  if (!product || !Array.isArray(product.variants)) return [];
  return product.variants.filter((variant) => variant.isActive !== false);
}

/** Default purchasable variant: first active variant, or `null`. */
export function getDefaultVariant(product) {
  return getActiveVariants(product)[0] ?? null;
}

/**
 * Variant availability from backend inventory truth (`inStock` boolean on
 * the variant). Returns `true`/`false` when known, `null` when the payload
 * carries no availability (unknown — never invented as in-stock).
 */
export function getVariantStockState(variant) {
  if (!variant || variant.inStock === undefined) return null;
  return Boolean(variant.inStock);
}

/** Product availability via its default purchasable variant (card-level). */
export function getProductStockState(product) {
  return getVariantStockState(getDefaultVariant(product));
}

/** Discount % for one variant, or `null` when no MRP claim exists. */
export function getVariantDiscountPercent(variant) {
  if (!variant) return null;
  return discountPercentFromStrings(variant.price, variant.compareAtPrice);
}

/** Best (max) discount % across a product's active variants, or `null`. */
export function getBestDiscountPercent(product) {
  const discounts = getActiveVariants(product)
    .map(getVariantDiscountPercent)
    .filter((value) => typeof value === 'number');
  return discounts.length > 0 ? Math.max(...discounts) : null;
}

/**
 * Does this product belong to the given normalized taxonomy category?
 * Matches by backend `categoryId` when the taxonomy carries real ids;
 * falls back to the embedded category-brief slug when ids are unavailable
 * (fallback taxonomy). Never matches unknown categories.
 */
export function productBelongsToCategory(product, category) {
  if (!product || !category) return false;
  if (category.id && product.categoryId) {
    return product.categoryId === category.id;
  }
  const slug = category.slug ?? '';
  if (!slug) return false;
  return product.category?.slug === slug || product.categoryId === slug;
}

/** Client-side category filter over a loaded dataset (no backend param). */
export function filterProductsByCategory(products, category) {
  if (!category) return products ?? [];
  return (products ?? []).filter((product) => productBelongsToCategory(product, category));
}

/**
 * Effective price of a product as a number (default purchasable variant).
 * Returns `null` when the product has no valid active variant — callers
 * must handle priceless products safely (never crash, never invent).
 */
export function getEffectivePriceNumber(product) {
  const variant = getDefaultVariant(product);
  if (!variant) return null;
  const value = Number(variant.price);
  return Number.isFinite(value) ? value : null;
}

/** Distinct brand names across a loaded dataset, sorted A–Z. */
export function getAvailableBrands(products) {
  const brands = new Set();
  for (const product of products ?? []) {
    if (typeof product?.brand === 'string' && product.brand.trim() !== '') {
      brands.add(product.brand.trim());
    }
  }
  return [...brands].sort((a, b) => a.localeCompare(b, 'en'));
}

/** Min/max effective prices across a loaded dataset (`{min, max}`, nulls when none). */
export function getPriceBounds(products) {
  let min = null;
  let max = null;
  for (const product of products ?? []) {
    const value = getEffectivePriceNumber(product);
    if (value === null) continue;
    if (min === null || value < min) min = value;
    if (max === null || value > max) max = value;
  }
  return { min, max };
}

/** Highest best-discount % across a loaded dataset, or `null` when none. */
export function getMaxDiscountPercent(products) {
  let max = null;
  for (const product of products ?? []) {
    const discount = getBestDiscountPercent(product);
    if (typeof discount !== 'number') continue;
    if (max === null || discount > max) max = discount;
  }
  return max;
}

/** Client-side brand filter (exact, case-insensitive). Unknown brands match nothing. */
export function filterProductsByBrand(products, brand) {
  if (typeof brand !== 'string' || brand.trim() === '') return products ?? [];
  const needle = brand.trim().toLowerCase();
  return (products ?? []).filter(
    (product) => typeof product?.brand === 'string' && product.brand.trim().toLowerCase() === needle,
  );
}

/**
 * Client-side effective-price range filter. `null`/invalid bounds are
 * ignored; products without a valid price are excluded only while a bound
 * is active.
 */
export function filterProductsByPriceRange(products, min, max) {
  const hasMin = typeof min === 'number' && Number.isFinite(min);
  const hasMax = typeof max === 'number' && Number.isFinite(max);
  if (!hasMin && !hasMax) return products ?? [];
  return (products ?? []).filter((product) => {
    const value = getEffectivePriceNumber(product);
    if (value === null) return false;
    if (hasMin && value < min) return false;
    if (hasMax && value > max) return false;
    return true;
  });
}

/**
 * Client-side minimum-discount filter. Uses the single shared discount
 * derivation (`getBestDiscountPercent`) — no duplicated math.
 */
export function filterProductsByMinDiscount(products, minPercent) {
  if (typeof minPercent !== 'number' || !Number.isFinite(minPercent) || minPercent <= 0) {
    return products ?? [];
  }
  return (products ?? []).filter((product) => {
    const discount = getBestDiscountPercent(product);
    return typeof discount === 'number' && discount >= minPercent;
  });
}

/** Client-side featured-only filter (`isFeatured` — the only supported curation signal). */
export function filterFeaturedOnly(products) {
  return (products ?? []).filter((product) => product?.isFeatured === true);
}

/** Sort keys supported by the Shop sort control (URL `sort` values). */
export const SHOP_SORT_OPTIONS = [
  { value: 'featured', label: 'Featured' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'discount-desc', label: 'Discount' },
  { value: 'name-asc', label: 'Name: A to Z' },
];

/**
 * Client-side sort over a loaded dataset. Unknown/absent keys preserve
 * catalog order (the `sort=newest` New Arrivals convention keeps working).
 */
export function sortProducts(products, sortKey) {
  const list = [...(products ?? [])];
  switch (sortKey) {
    case 'newest':
      return sortProductsNewest(list);
    case 'featured':
      return list.sort((a, b) => Number(b?.isFeatured === true) - Number(a?.isFeatured === true));
    case 'price-asc':
      return list.sort((a, b) => {
        const aPrice = getEffectivePriceNumber(a);
        const bPrice = getEffectivePriceNumber(b);
        if (aPrice === null && bPrice === null) return 0;
        if (aPrice === null) return 1;
        if (bPrice === null) return -1;
        return aPrice - bPrice;
      });
    case 'price-desc':
      return list.sort((a, b) => {
        const aPrice = getEffectivePriceNumber(a);
        const bPrice = getEffectivePriceNumber(b);
        if (aPrice === null && bPrice === null) return 0;
        if (aPrice === null) return 1;
        if (bPrice === null) return -1;
        return bPrice - aPrice;
      });
    case 'discount-desc':
      return list.sort((a, b) => (getBestDiscountPercent(b) ?? -1) - (getBestDiscountPercent(a) ?? -1));
    case 'name-asc':
      return list.sort((a, b) => (a?.name ?? '').localeCompare(b?.name ?? '', 'en'));
    default:
      return list;
  }
}

/**
 * Client-side pagination over a filtered/sorted array (no backend params).
 * Returns `{ items, page, pageCount, total }` with the page clamped into
 * range — never an empty crash page for an out-of-range request.
 */
export function paginateProducts(items, page, pageSize) {
  const total = (items ?? []).length;
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 12;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, Number.isInteger(page) ? page : 1), pageCount);
  return {
    items: (items ?? []).slice((safePage - 1) * size, safePage * size),
    page: safePage,
    pageCount,
    total,
  };
}

/** Client-side newest-first sort over a loaded dataset (`createdAt` desc). */
export function sortProductsNewest(products) {
  return [...(products ?? [])].sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}

/** Related products: same `categoryId`, excluding self, capped at `limit`. */
export function getRelatedProducts(products, product, limit = 4) {
  if (!product?.categoryId) return [];
  return (products ?? [])
    .filter((item) => item?.id !== product.id && item?.categoryId === product.categoryId)
    .slice(0, limit);
}

/**
 * Featured rail (honestly labeled — `isFeatured` is the only supported
 * curation signal; there is NO popularity endpoint, so this is never
 * presented as "Most Popular").
 */
export function selectFeaturedProducts(products, limit = 10) {
  return (products ?? []).filter((product) => product?.isFeatured).slice(0, limit);
}

/** New Arrivals rail: `createdAt` descending, capped at `limit`. */
export function selectNewArrivals(products, limit = 10) {
  return sortProductsNewest(products).slice(0, limit);
}

/**
 * Maximum Discounted rail: best variant `% off` descending (variants
 * without `compareAtPrice` are skipped — no MRP claim, no badge).
 */
export function selectMaxDiscountedProducts(products, limit = 10) {
  return [...(products ?? [])]
    .map((product) => ({ product, discount: getBestDiscountPercent(product) ?? -1 }))
    .filter((entry) => entry.discount >= 0)
    .sort((a, b) => b.discount - a.discount)
    .slice(0, limit)
    .map((entry) => entry.product);
}

const normalizeHaystack = (value) =>
  typeof value === 'string' ? value.toLowerCase() : '';

/**
 * Client-side text search over the loaded catalog (no backend endpoint —
 * API_INTEGRATION §7 / GAP-04). Matches product `name`/`brand`/
 * `shortDescription`/`description`, variant `name`/`sku`, and category
 * name. Deterministic: catalog order preserved. Empty query → `[]`.
 */
export function searchProducts(products, rawQuery) {
  const query = normalizeHaystack(rawQuery).trim();
  if (!query) return [];
  const terms = query.split(/\s+/);
  return (products ?? []).filter((product) => {
    if (!product) return false;
    const haystacks = [
      product.name,
      product.brand,
      product.shortDescription,
      product.description,
      product.category?.name,
      ...(Array.isArray(product.variants)
        ? product.variants.flatMap((variant) => [variant?.name, variant?.sku])
        : []),
    ].map(normalizeHaystack);
    return terms.every((term) => haystacks.some((haystack) => haystack.includes(term)));
  });
}

/**
 * Search-as-you-type suggestions over real catalog data (no backend
 * endpoint — same client-side basis as `searchProducts`).
 *
 * Returns `{ categories, products }` — top-level taxonomy categories whose
 * name contains the query plus matching products in catalog order with
 * name-prefix hits ranked first. Matching is case-insensitive and
 * whitespace-tolerant; results are deduplicated by id and capped at the
 * given limits. Queries shorter than 2 characters (after trimming)
 * return empty lists so the panel can show category shortcuts instead.
 * Deterministic: no analytics, recency, or popularity data is used.
 */
export function getSearchSuggestions(products, taxonomy, rawQuery, options = {}) {
  const { categoryLimit = 2, productLimit = 5 } = options;
  const query = normalizeHaystack(rawQuery).trim().replace(/\s+/g, ' ');
  if (query.length < 2) return { categories: [], products: [] };

  const matchedCategories = (taxonomy ?? [])
    .filter((category) => normalizeHaystack(category?.name).includes(query))
    .sort((a, b) => {
      const aStarts = normalizeHaystack(a?.name).startsWith(query) ? 0 : 1;
      const bStarts = normalizeHaystack(b?.name).startsWith(query) ? 0 : 1;
      return aStarts - bStarts;
    })
    .slice(0, categoryLimit);

  const matchedProducts = searchProducts(products, query)
    .sort((a, b) => {
      const aStarts = normalizeHaystack(a?.name).startsWith(query) ? 0 : 1;
      const bStarts = normalizeHaystack(b?.name).startsWith(query) ? 0 : 1;
      return aStarts - bStarts;
    })
    .slice(0, productLimit);

  return { categories: matchedCategories, products: matchedProducts };
}
