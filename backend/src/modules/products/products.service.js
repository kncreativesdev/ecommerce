const { AppError } = require("../../utils/appError");
const productsRepository = require("./products.repository");
const { findCategoryById } = require("../categories/categories.repository");
const { ORDER_IN_PROCESS_STATUSES } = require("../orders/orders.service");
const { normalizeSlug, toSafeProduct, toSafeVariant } = require("./products.utils");
const { resolveActorSnapshot, assertAuditInput, recordAuditEvent } = require("../audit/audit.service");

const PRODUCT_UPDATABLE_FIELDS = [
  "name",
  "slug",
  "description",
  "shortDescription",
  "brand",
  "categoryId",
  "isActive",
  "isFeatured",
];

const VARIANT_UPDATABLE_FIELDS = [
  "name",
  "sku",
  "price",
  "compareAtPrice",
  "barcode",
  "weight",
  "isActive",
];

function normalizeDecimal(value, options) {
  const { decimals, maxIntegerDigits, field } = options;
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^\d+(\.\d+)?$/.test(raw)) {
    throw new AppError(422, "VALIDATION_ERROR", `${field} must be a valid non-negative decimal number`);
  }
  const dot = raw.indexOf(".");
  const intPart = (dot === -1 ? raw : raw.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const fracPart = dot === -1 ? "" : raw.slice(dot + 1);
  if (fracPart.length > decimals) {
    throw new AppError(422, "VALIDATION_ERROR", `${field} must have at most ${decimals} decimal places`);
  }
  if (intPart.length > maxIntegerDigits) {
    throw new AppError(422, "VALIDATION_ERROR", `${field} exceeds the maximum supported value`);
  }
  return `${intPart}.${fracPart.padEnd(decimals, "0")}`;
}

function normalizePrice(value, field) {
  return normalizeDecimal(value, { decimals: 2, maxIntegerDigits: 8, field });
}

function normalizeWeight(value, field) {
  return normalizeDecimal(value, { decimals: 3, maxIntegerDigits: 7, field });
}

function resolveSlug(rawSlug, name) {
  const slug = normalizeSlug(rawSlug !== undefined ? rawSlug : name);
  if (slug === "") {
    throw new AppError(422, "VALIDATION_ERROR", "Slug must contain at least one letter or digit");
  }
  return slug;
}

function conflictTarget(err) {
  const meta = err.meta || {};
  if (Array.isArray(meta.target)) {
    return meta.target.join(",").toLowerCase();
  }
  const cause = meta.driverAdapterError?.cause || {};
  const parts = [];
  if (cause.constraint && typeof cause.constraint.index === "string") {
    parts.push(cause.constraint.index);
  }
  if (typeof cause.originalMessage === "string") {
    parts.push(cause.originalMessage);
  }
  return parts.join(",").toLowerCase();
}

function mapVariantConflict(err) {
  if (err.code === "P2002") {
    const target = conflictTarget(err);
    if (target.includes("barcode")) {
      throw new AppError(409, "PRODUCT_VARIANT_BARCODE_EXISTS", "Variant barcode already exists");
    }
    throw new AppError(409, "PRODUCT_VARIANT_SKU_EXISTS", "Variant SKU already exists");
  }
  throw err;
}

/**
 * Phase 2C-1 category gate: the category must exist, be active, AND
 * belong to the creator's company. Cross-company categories fail with
 * the same 404 as missing ones — no existence oracle.
 */
async function assertActiveCategory(categoryId, companyId) {
  const category = await findCategoryById(categoryId);
  if (!category || !category.isActive || category.companyId !== companyId) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }
  return category;
}

function assertCreatorCompany(companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  return companyId;
}

/**
 * Phase 3-2 RBAC: active-state writes need an explicit grant. ADMIN and
 * HEAD hold product:DEACTIVATE; MEMBER holds CREATE/READ/UPDATE only,
 * so a MEMBER caller may never submit `isActive: false` (neither on
 * the product nor on nested creation variants) nor any explicit
 * `isActive` on PATCH. The HTTP controller always supplies
 * `actor.roles`; a missing roles array fails closed. Hard deletion
 * (`DELETE /products/:id`) and variant endpoints stay ADMIN-only at
 * the route layer and need no check here.
 */
function assertMayWriteProductActiveState(actor) {
  const roles = actor && Array.isArray(actor.roles) ? actor.roles : [];
  if (roles.includes("ADMIN") || roles.includes("HEAD")) {
    return;
  }
  throw new AppError(403, "AUTH_FORBIDDEN", "Insufficient permissions to set isActive");
}

/**
 * Phase 3-3 RBAC: same active-state rule for standalone variant
 * endpoints. Variants carry no separate permission namespace in
 * `permissions.js` — they are product-sub-resource operations
 * covered by the product grants (P.3 denormalized membership,
 * nested creation inside product CREATE, no standalone reads),
 * consistent with the Phase 3-2 nested-variant allowance. ADMIN and
 * HEAD hold product:DEACTIVATE; MEMBER holds CREATE/UPDATE only.
 * Variant soft-deactivation (`DELETE …/variants/:variantId`) stays
 * ADMIN/HEAD at the route layer and needs no check here.
 */
function assertMayWriteVariantActiveState(actor) {
  const roles = actor && Array.isArray(actor.roles) ? actor.roles : [];
  if (roles.includes("ADMIN") || roles.includes("HEAD")) {
    return;
  }
  throw new AppError(403, "AUTH_FORBIDDEN", "Insufficient permissions to set isActive");
}

/**
 * Phase 2C-17 mutation audit. Single-write catalog operations use the
 * post-commit pattern (recorded only after success); the two
 * multi-write transactions (creation, guarded deactivation) carry the
 * validated payload inside via the repository audit parameter.
 */
async function snapshotActor(actor) {
  return actor && actor.id ? resolveActorSnapshot(actor.id) : null;
}

function productEvent(snapshot, companyId, action, row) {
  return assertAuditInput({
    actorId: snapshot ? snapshot.id : null,
    actorRole: snapshot ? snapshot.role : "SYSTEM",
    actorEmail: snapshot ? snapshot.email : null,
    companyId,
    action,
    resource: "PRODUCT",
    resourceId: row.id,
    outcome: "SUCCESS",
    details: { name: row.name },
  });
}

function variantEvent(snapshot, companyId, action, row) {
  return assertAuditInput({
    actorId: snapshot ? snapshot.id : null,
    actorRole: snapshot ? snapshot.role : "SYSTEM",
    actorEmail: snapshot ? snapshot.email : null,
    companyId,
    action,
    resource: "PRODUCT_VARIANT",
    resourceId: row.id,
    outcome: "SUCCESS",
    details: { sku: row.sku ?? null },
  });
}

function buildVariantData(input) {
  return {
    sku: input.sku,
    name: input.name,
    price: normalizePrice(input.price, "price"),
    compareAtPrice:
      input.compareAtPrice === undefined || input.compareAtPrice === null
        ? null
        : normalizePrice(input.compareAtPrice, "compareAtPrice"),
    barcode: input.barcode ?? null,
    weight:
      input.weight === undefined || input.weight === null
        ? null
        : normalizeWeight(input.weight, "weight"),
    isActive: input.isActive ?? true,
  };
}

/**
 * Phase 2C-12 public storefront rule (mirrors categories): no resolved
 * company → no catalog data, using the existing not-found code.
 * Embedded variants/images/category briefs follow the gated root
 * product, so no nested relation can cross companies.
 */
function assertPublicCompany(companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  return companyId;
}

async function listProducts(status = "active", companyId = null) {
  assertPublicCompany(companyId);
  const rows = await productsRepository.findProductsByStatus(status, companyId);
  return rows.map(toSafeProduct);
}

async function getProduct(id, scope = "active", companyId = null) {
  assertPublicCompany(companyId);
  const row =
    scope === "all"
      ? await productsRepository.findProductById(id, companyId)
      : await productsRepository.findActiveProductById(id, companyId);
  if (!row) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  return toSafeProduct(row);
}

async function createProduct(companyId, input, actor = null) {
  assertCreatorCompany(companyId);
  await assertActiveCategory(input.categoryId, companyId);
  // Phase 3-2: creating an inactive product (or inactive nested
  // variant) is an active-state write, not part of plain CREATE.
  const nestedInactive = Array.isArray(input.variants) && input.variants.some((variant) => variant && variant.isActive === false);
  if (input.isActive === false || nestedInactive) {
    assertMayWriteProductActiveState(actor);
  }
  const slug = resolveSlug(input.slug, input.name);

  // Variants inherit the product's (creator's) company atomically in the
  // same transaction — the P.3 denormalized invariant at write time.
  const variantsData = (input.variants ?? []).map((variant) => ({
    ...buildVariantData(variant),
    companyId,
  }));

  // The audit payload is validated here and written inside the creation
  // transaction — a rolled-back create leaves no audit row behind. The
  // repository stamps the created product id as the resource.
  const snapshot = await snapshotActor(actor);
  const audit = productEvent(snapshot, companyId, "CREATED", { id: null, name: input.name });
  try {
    const row = await productsRepository.createProductWithVariants(
      {
        name: input.name,
        slug,
        description: input.description ?? null,
        shortDescription: input.shortDescription ?? null,
        brand: input.brand ?? null,
        categoryId: input.categoryId,
        isActive: input.isActive ?? true,
        isFeatured: input.isFeatured ?? false,
        companyId,
      },
      variantsData,
      audit
    );
    return toSafeProduct(row);
  } catch (err) {
    if (err.code === "P2002") {
      if (conflictTarget(err).includes("slug")) {
        throw new AppError(409, "PRODUCT_SLUG_EXISTS", "Product slug already exists");
      }
      mapVariantConflict(err);
    }
    throw err;
  }
}

async function updateProduct(id, companyId, input, actor = null) {
  assertCreatorCompany(companyId);
  const existing = await productsRepository.findProductById(id, companyId);
  if (!existing) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }

  const data = {};
  for (const field of PRODUCT_UPDATABLE_FIELDS) {
    if (input[field] !== undefined) {
      data[field] = input[field];
    }
  }

  // Phase 3-2: any explicit `isActive` on PATCH is an active-state
  // write (flip or re-affirmation alike), reserved to ADMIN/HEAD.
  if (data.isActive !== undefined) {
    assertMayWriteProductActiveState(actor);
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(422, "PRODUCT_UPDATE_INVALID", "No updatable fields provided");
  }

  if (data.slug !== undefined) {
    data.slug = resolveSlug(data.slug, existing.name);
  }

  if (data.categoryId !== undefined) {
    await assertActiveCategory(data.categoryId, existing.companyId);
  }

  // Deactivation transition (active → inactive) goes through the guarded
  // path: the in-process order check and the state change run inside one
  // transaction. Any other fields in the same request are applied
  // afterwards; reactivation (isActive true) needs no eligibility check.
  if (data.isActive === false && existing.isActive === true) {
    const rest = { ...data };
    delete rest.isActive;
    let row;
    // The guarded deactivation carries the audit inside its transaction
    // (no record when a raced deactivation made it a no-op).
    const snapshot = await snapshotActor(actor);
    let result;
    try {
      result = await productsRepository.deactivateProductGuarded(
        id,
        companyId,
        ORDER_IN_PROCESS_STATUSES,
        productEvent(snapshot, companyId, "DEACTIVATED", { id, name: existing.name })
      );
    } catch (err) {
      if (err.code === "P2025") {
        throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
      }
      throw err;
    }
    row = result.row;
    if (Object.keys(rest).length === 0) {
      return toSafeProduct(row);
    }
    try {
      const updated = await productsRepository.updateProduct(id, rest);
      await recordAuditEvent(productEvent(snapshot, companyId, "UPDATED", updated));
      return toSafeProduct(updated);
    } catch (err) {
      if (err.code === "P2002") {
        throw new AppError(409, "PRODUCT_SLUG_EXISTS", "Product slug already exists");
      }
      if (err.code === "P2025") {
        throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
      }
      throw err;
    }
  }

  try {
    const row = await productsRepository.updateProduct(id, data);
    const flipped = data.isActive !== undefined && data.isActive !== existing.isActive;
    await recordAuditEvent(
      productEvent(
        await snapshotActor(actor),
        companyId,
        flipped ? (data.isActive ? "REACTIVATED" : "DEACTIVATED") : "UPDATED",
        row
      )
    );
    return toSafeProduct(row);
  } catch (err) {
    if (err.code === "P2002") {
      throw new AppError(409, "PRODUCT_SLUG_EXISTS", "Product slug already exists");
    }
    if (err.code === "P2025") {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
    }
    throw err;
  }
}

/**
 * Product removal (`DELETE /products/:id`). Lifecycle rule: an ACTIVE
 * product must be deactivated first — deletion of an active product is
 * rejected with 409 and the product is left unchanged. An already
 * inactive product follows the existing deletion semantics
 * (idempotent soft-deactivate confirmation). Historical order data is
 * never touched.
 */
async function deactivateProduct(id, companyId, actor = null) {
  assertCreatorCompany(companyId);
  const existing = await productsRepository.findProductById(id, companyId);
  if (!existing) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  if (existing.isActive) {
    throw new AppError(
      409,
      "PRODUCT_ACTIVE_CANNOT_DELETE",
      `Cannot delete "${existing.name}" while it is active. Deactivate it first, then delete.`
    );
  }
  const row = await productsRepository.deactivateProduct(id);
  await recordAuditEvent(productEvent(await snapshotActor(actor), companyId, "DELETED", row));
  return toSafeProduct(row);
}

async function createVariant(productId, companyId, input, actor = null) {
  assertCreatorCompany(companyId);
  // The creator may only extend their own company's products: a
  // cross-company productId fails exactly like a missing one, and the
  // variant then inherits that (verified same-company) product.
  const product = await productsRepository.findProductById(productId, companyId);
  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  // Phase 3-3: creating an inactive variant is an active-state write,
  // not part of plain CREATE. The default (omitted → active) is
  // unaffected.
  if (input.isActive === false) {
    assertMayWriteVariantActiveState(actor);
  }

  try {
    // The variant inherits its parent product's company (never the
    // request), keeping the denormalized invariant exact by construction.
    const row = await productsRepository.createVariant(productId, {
      ...buildVariantData(input),
      companyId: product.companyId,
    });
    await recordAuditEvent(variantEvent(await snapshotActor(actor), companyId, "CREATED", row));
    return toSafeVariant(row);
  } catch (err) {
    mapVariantConflict(err);
  }
}

async function updateVariant(productId, variantId, companyId, input, actor = null) {
  assertCreatorCompany(companyId);
  const existing = await productsRepository.findVariantByIdAndProductId(variantId, productId, companyId);
  if (!existing) {
    throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
  }

  const data = {};
  for (const field of VARIANT_UPDATABLE_FIELDS) {
    if (input[field] !== undefined) {
      data[field] = input[field];
    }
  }

  // Phase 3-3: any explicit `isActive` on variant PATCH is an
  // active-state write (flip or re-affirmation alike), reserved to
  // ADMIN/HEAD.
  if (data.isActive !== undefined) {
    assertMayWriteVariantActiveState(actor);
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(422, "PRODUCT_VARIANT_UPDATE_INVALID", "No updatable fields provided");
  }

  if (data.price !== undefined) {
    data.price = normalizePrice(data.price, "price");
  }
  if (data.compareAtPrice !== undefined && data.compareAtPrice !== null) {
    data.compareAtPrice = normalizePrice(data.compareAtPrice, "compareAtPrice");
  }
  if (data.weight !== undefined && data.weight !== null) {
    data.weight = normalizeWeight(data.weight, "weight");
  }

  try {
    const row = await productsRepository.updateVariant(existing.id, data);
    const flipped = data.isActive !== undefined && data.isActive !== existing.isActive;
    await recordAuditEvent(
      variantEvent(
        await snapshotActor(actor),
        companyId,
        flipped ? (data.isActive ? "REACTIVATED" : "DEACTIVATED") : "UPDATED",
        row
      )
    );
    return toSafeVariant(row);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
    }
    mapVariantConflict(err);
  }
}

async function deactivateVariant(productId, variantId, companyId, actor = null) {
  assertCreatorCompany(companyId);
  const existing = await productsRepository.findVariantByIdAndProductId(variantId, productId, companyId);
  if (!existing) {
    throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
  }
  const row = await productsRepository.deactivateVariant(existing.id);
  await recordAuditEvent(variantEvent(await snapshotActor(actor), companyId, "DEACTIVATED", row));
  return toSafeVariant(row);
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deactivateProduct,
  createVariant,
  updateVariant,
  deactivateVariant,
};
