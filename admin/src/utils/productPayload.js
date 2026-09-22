/**
 * Product payload adapter: maps the Product Form's taxonomy selection to
 * the backend payload. THE seam for future subcategory persistence.
 *
 * Form-level selection (UI taxonomy, always available):
 * `{ parentCategoryId, subcategoryId }`
 *
 * CURRENT backend payload (verified `createProductSchema` /
 * `updateProductSchema` — `categoryId` only, strict bodies):
 * `{ categoryId: parentCategoryId, ...fields }`
 *
 * `subcategoryId` is accepted here so the form architecture never changes,
 * but is NEVER sent today (sending it yields `422`). When the backend adds
 * product→subcategory persistence, enable it in exactly one place —
 * `withSubcategorySupport()` below — without touching the form, the
 * selectors, or the service.
 */

function stripEmptyStrings(fields) {
  const clean = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === '' || value === undefined) continue;
    clean[key] = value;
  }
  return clean;
}

function baseFields(input) {
  return stripEmptyStrings({
    name: input.name?.trim(),
    slug: input.slug?.trim() || undefined,
    description: input.description?.trim() || null,
    shortDescription: input.shortDescription?.trim() || null,
    brand: input.brand?.trim() || null,
    isActive: input.isActive,
    isFeatured: input.isFeatured,
  });
}

function variantPayload(variant) {
  if (!variant) return undefined;
  const clean = stripEmptyStrings({
    sku: variant.sku?.trim(),
    name: variant.name?.trim(),
    price: variant.price?.toString().trim(),
    compareAtPrice: variant.compareAtPrice?.toString().trim() || null,
    barcode: variant.barcode?.trim() || null,
    weight: variant.weight?.toString().trim() || null,
  });
  if (!clean.sku || !clean.name || !clean.price) return undefined;
  return clean;
}

/**
 * Build a `POST /products` payload from form values + taxonomy selection.
 * `subcategoryId` is intentionally dropped (see module doc).
 * `variants` is an array of per-row form entries (each validated by the
 * form — SKU/name/price required); incomplete rows never reach here, and
 * an empty array sends no `variants` key (product shell, existing
 * backend behavior).
 */
export function buildCreateProductPayload({ parentCategoryId, subcategoryId, fields, variants }) {
  void subcategoryId;
  const payload = {
    ...baseFields(fields),
    categoryId: parentCategoryId,
  };
  const list = Array.isArray(variants)
    ? variants.map(variantPayload).filter(Boolean)
    : [];
  if (list.length > 0) payload.variants = list;
  return payload;
}

/**
 * Build a `PATCH /products/:id` payload. The update schema accepts product
 * fields ONLY (no `variants` key) — variant edits travel via the dedicated
 * variant endpoints in a follow-up milestone.
 */
export function buildUpdateProductPayload({ parentCategoryId, subcategoryId, fields }) {
  void subcategoryId;
  return {
    ...baseFields(fields),
    categoryId: parentCategoryId,
  };
}

/**
 * FUTURE migration point. When the backend documents product→subcategory
 * persistence, replace the `void subcategoryId;` drops above with:
 *
 *   ...(subcategoryId ? { subcategoryId } : {}),
 *
 * in both builders (after verifying the documented field name). No form,
 * selector, service, or validation-architecture change is required.
 */
