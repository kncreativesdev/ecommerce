/**
 * Admin taxonomy utilities: normalize the flat backend category list into
 * ONE reusable tree consumed by Category Management, the Product Form
 * (Parent Category → Subcategory selectors), and future filters.
 *
 * Backend representation (verified): each record carries
 * `{ id, name, slug, description, image, parentId, sortOrder, isActive }`.
 * `parentId === null` → top-level Category; otherwise a Subcategory whose
 * parent is the category with that id. No separate subcategory model
 * exists — never invent one here.
 *
 * Tree node shape: `{ ...record, children: [...] }`, roots and children
 * each ordered by `sortOrder` ascending.
 */

/** Normalize one backend category record (defensive copy, same fields). */
export function adaptCategory(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    id: record.id ?? null,
    name: record.name ?? '',
    slug: record.slug ?? '',
    description: record.description ?? null,
    image: record.image ?? null,
    parentId: record.parentId ?? null,
    sortOrder: record.sortOrder ?? 0,
    isActive: record.isActive ?? true,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
  };
}

export function adaptCategoryList(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.map(adaptCategory).filter((category) => category && category.id);
}

const bySortOrder = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

/**
 * Build the reusable category tree: roots (`parentId == null`) with nested
 * `children` (records whose `parentId` matches). Orphans (unknown parent)
 * are kept as roots so no backend row is ever silently dropped.
 */
export function buildCategoryTree(categories) {
  const list = categories ?? [];
  const byId = new Map(list.map((category) => [category.id, { ...category, children: [] }]));
  const roots = [];

  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortDeep = (nodes) => {
    nodes.sort(bySortOrder);
    nodes.forEach((node) => sortDeep(node.children));
    return nodes;
  };
  return sortDeep(roots);
}

/** Flat lookup of any category (root or child) by id. */
export function findCategoryById(categories, id) {
  if (!id) return undefined;
  return (categories ?? []).find((category) => category.id === id);
}

/**
 * Subcategories available under one parent — THE dependency behind the
 * Product Form's dependent Subcategory selector: only children of the
 * selected Parent Category are ever offered. Returns `[]` for unknown
 * parents. (`parentId: null` intentionally yields `[]`: top-level
 * categories are not subcategories of "None".)
 */
export function getSubcategories(categories, parentId) {
  if (!parentId) return [];
  return (categories ?? [])
    .filter((category) => category.parentId === parentId)
    .sort(bySortOrder);
}

/** Top-level categories (parent candidates), `sortOrder` ascending. */
export function getParentCategories(categories) {
  return (categories ?? [])
    .filter((category) => (category.parentId ?? null) === null)
    .sort(bySortOrder);
}

/**
 * Ids that must never be offered as a parent for `categoryId` (the row
 * itself plus all descendants) — prevents self-parent and ancestor cycles
 * client-side. The backend re-validates (`CATEGORY_SELF_PARENT`,
 * `CATEGORY_CYCLE`); this is UX layering, not authorization.
 */
export function getForbiddenParentIds(categories, categoryId) {
  if (!categoryId) return [];
  const forbidden = new Set([categoryId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const category of categories ?? []) {
      if (category.parentId && forbidden.has(category.parentId) && !forbidden.has(category.id)) {
        forbidden.add(category.id);
        expanded = true;
      }
    }
  }
  return [...forbidden];
}
