import {
  BatteryCharging,
  Cable,
  Car,
  Headphones,
  Monitor,
  Package,
  PlugZap,
  Speaker,
  Watch,
} from 'lucide-react';

/**
 * Taxonomy adapter: the single boundary between backend category payloads
 * and the normalized internal taxonomy consumed by CategoryMegaMenu,
 * MobileMenu, SearchPanel chips, future Shop filters, future Admin category
 * selectors, and the future Admin Product Form (category → subcategory).
 *
 * Normalized category shape:
 * `{ id, slug, name, description, image, parentId, sortOrder, icon,
 *    subcategorySource: 'api' | 'fallback' | 'none',
 *    subcategories: [{ id, slug, name, description, blurb, image, icon }] }`
 *
 * Backend reality (API_INTEGRATION.md §5, API_CONTRACT_MATRIX): categories
 * expose `id, name, slug, description, image, parentId (nullable),
 * isActive, sortOrder`. There is NO subcategory endpoint and NO product →
 * subcategory field — hierarchy is derived client-side from `parentId`
 * (same pattern as PAGES.md §3 sub-category chips). Until a formal
 * subcategory contract exists, categories with no API children keep the
 * frontend fallback subcategories, flagged via `subcategorySource`, so the
 * UI transitions to backend data without component rewrites and without
 * pretending the backend supports subcategories.
 */

const CATEGORY_ICONS = {
  'power-banks': BatteryCharging,
  chargers: PlugZap,
  cables: Cable,
  'wireless-earbuds': Headphones,
  'bluetooth-speakers': Speaker,
  'car-accessories': Car,
  'smart-accessories': Watch,
  'desk-accessories': Monitor,
};

/** Slug → Lucide icon with a generic fallback for unknown slugs. */
export function categoryIconForSlug(slug) {
  return CATEGORY_ICONS[slug] ?? Package;
}

/** Normalize one backend category record. No fields are invented. */
export function adaptBackendCategory(record) {
  return {
    id: record.id ?? null,
    slug: record.slug,
    name: record.name,
    description: record.description ?? '',
    image: record.image ?? null,
    parentId: record.parentId ?? null,
    sortOrder: record.sortOrder ?? 0,
    icon: categoryIconForSlug(record.slug),
    subcategorySource: 'none',
    subcategories: [],
  };
}

/** Bring the static fallback seam into the normalized shape. */
export function normalizeFallbackTaxonomy(fallbackItems) {
  return fallbackItems.map((category, index) => ({
    id: category.id ?? null,
    slug: category.slug,
    name: category.name,
    description: category.description ?? '',
    image: category.image ?? null,
    parentId: null,
    sortOrder: index,
    icon: category.icon ?? categoryIconForSlug(category.slug),
    subcategorySource: 'fallback',
    subcategories: (category.subcategories ?? []).map((sub) => ({
      id: sub.id ?? null,
      slug: sub.slug,
      name: sub.name,
      description: sub.description ?? sub.blurb ?? '',
      blurb: sub.blurb ?? '',
      image: sub.image ?? null,
      icon: sub.icon ?? null,
    })),
  }));
}

function adaptApiChild(record) {
  return {
    id: record.id ?? null,
    slug: record.slug,
    name: record.name,
    description: record.description ?? '',
    blurb: '',
    image: record.image ?? null,
    icon: categoryIconForSlug(record.slug),
  };
}

function fallbackSubcategoriesFor(fallbackItems, slug) {
  const match = (fallbackItems ?? []).find((category) => category.slug === slug);
  return (match?.subcategories ?? []).map((sub) => ({
    id: sub.id ?? null,
    slug: sub.slug,
    name: sub.name,
    description: sub.description ?? sub.blurb ?? '',
    blurb: sub.blurb ?? '',
    image: sub.image ?? null,
    icon: sub.icon ?? null,
  }));
}

/**
 * Build the render-ready taxonomy from a `GET /categories` payload.
 * Roots (`parentId == null`, `sortOrder` ascending) come from the API;
 * children (`parentId` match) become API subcategories. A root with no API
 * children keeps the documented frontend fallback subcategories
 * (`subcategorySource: 'fallback'`) — an explicit, temporary presentation
 * seam, never presented as backend-backed.
 */
export function buildTaxonomy(apiCategories, { fallback = [] } = {}) {
  const records = Array.isArray(apiCategories) ? apiCategories : [];
  const roots = records
    .filter((record) => record && (record.parentId ?? null) === null)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return roots.map((record) => {
    const normalized = adaptBackendCategory(record);
    const children = records
      .filter((child) => child && child.parentId === record.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    if (children.length > 0) {
      normalized.subcategorySource = 'api';
      normalized.subcategories = children.map(adaptApiChild);
    } else {
      const fallbackSubs = fallbackSubcategoriesFor(fallback, normalized.slug);
      if (fallbackSubs.length > 0) {
        normalized.subcategorySource = 'fallback';
        normalized.subcategories = fallbackSubs;
      }
    }
    return normalized;
  });
}

function slugOf(value) {
  if (typeof value === 'string') return value;
  return value?.slug ?? value?.id ?? '';
}

/**
 * Temporary route param for a category until reads standardize on UUIDs.
 * Accepts the normalized category object.
 */
export function categoryRouteParam(category) {
  return category?.id ?? category?.slug ?? '';
}

/**
 * Canonical shop link for a subcategory tile. Slug-first today; accepts
 * `{ slug }` or `{ id }` objects so a future id-based URL convention lands
 * here without rewriting every call site. Format extends the documented
 * `/shop?sort=newest` convention — no subcategory filter convention is
 * documented yet.
 */
export function subcategoryShopLink(category, subcategory) {
  const params = new URLSearchParams({
    category: slugOf(category),
    subcategory: slugOf(subcategory),
  });
  return `/shop?${params.toString()}`;
}

/** Find a category in a normalized taxonomy by slug. */
export function findCategory(taxonomy, slug) {
  return (taxonomy ?? []).find((category) => category.slug === slug);
}

/**
 * Subcategories belonging to one category — the exact dependency for the
 * future Admin Product Form: the subcategory selector renders
 * `getSubcategories(taxonomy, selectedCategorySlug)` so only the selected
 * category's children are selectable. Returns `[]` for unknown slugs.
 */
export function getSubcategories(taxonomy, categorySlug) {
  return findCategory(taxonomy, categorySlug)?.subcategories ?? [];
}
