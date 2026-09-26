const { AppError } = require("../../utils/appError");
const productsRepository = require("./products.repository");
const { findCategoryById } = require("../categories/categories.repository");
const { normalizeSlug, toSafeProduct, toSafeVariant } = require("./products.utils");

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

async function assertActiveCategory(categoryId) {
  const category = await findCategoryById(categoryId);
  if (!category || !category.isActive) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }
  return category;
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

async function listProducts(status = "active") {
  const rows = await productsRepository.findProductsByStatus(status);
  return rows.map(toSafeProduct);
}

async function getProduct(id, scope = "active") {
  const row =
    scope === "all"
      ? await productsRepository.findProductById(id)
      : await productsRepository.findActiveProductById(id);
  if (!row) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  return toSafeProduct(row);
}

async function createProduct(input) {
  await assertActiveCategory(input.categoryId);
  const slug = resolveSlug(input.slug, input.name);

  const variantsData = (input.variants ?? []).map(buildVariantData);

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
      },
      variantsData
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

async function updateProduct(id, input) {
  const existing = await productsRepository.findProductById(id);
  if (!existing) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }

  const data = {};
  for (const field of PRODUCT_UPDATABLE_FIELDS) {
    if (input[field] !== undefined) {
      data[field] = input[field];
    }
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(422, "PRODUCT_UPDATE_INVALID", "No updatable fields provided");
  }

  if (data.slug !== undefined) {
    data.slug = resolveSlug(data.slug, existing.name);
  }

  if (data.categoryId !== undefined) {
    await assertActiveCategory(data.categoryId);
  }

  try {
    const row = await productsRepository.updateProduct(id, data);
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

async function deactivateProduct(id) {
  const existing = await productsRepository.findProductById(id);
  if (!existing) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  const row = await productsRepository.deactivateProduct(id);
  return toSafeProduct(row);
}

async function createVariant(productId, input) {
  const product = await productsRepository.findProductById(productId);
  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }

  try {
    const row = await productsRepository.createVariant(productId, buildVariantData(input));
    return toSafeVariant(row);
  } catch (err) {
    mapVariantConflict(err);
  }
}

async function updateVariant(productId, variantId, input) {
  const existing = await productsRepository.findVariantByIdAndProductId(variantId, productId);
  if (!existing) {
    throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
  }

  const data = {};
  for (const field of VARIANT_UPDATABLE_FIELDS) {
    if (input[field] !== undefined) {
      data[field] = input[field];
    }
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
    return toSafeVariant(row);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
    }
    mapVariantConflict(err);
  }
}

async function deactivateVariant(productId, variantId) {
  const existing = await productsRepository.findVariantByIdAndProductId(variantId, productId);
  if (!existing) {
    throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
  }
  const row = await productsRepository.deactivateVariant(existing.id);
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
