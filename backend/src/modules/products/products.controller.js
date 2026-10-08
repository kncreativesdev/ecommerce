const { AppError } = require("../../utils/appError");
const productsService = require("./products.service");
const {
  createProductSchema,
  updateProductSchema,
  createVariantSchema,
  updateVariantSchema,
} = require("./products.validation");

const LIST_STATUSES = new Set(["active", "inactive", "all"]);
const DETAIL_SCOPES = new Set(["active", "all"]);

function parseListStatus(query) {
  const status = query.status === undefined ? "active" : query.status;
  if (!LIST_STATUSES.has(status)) {
    throw new AppError(422, "VALIDATION_ERROR", "Invalid status filter. Use active, inactive, or all.");
  }
  return status;
}

function parseDetailScope(query) {
  const scope = query.status === undefined ? "active" : query.status;
  if (!DETAIL_SCOPES.has(scope)) {
    throw new AppError(422, "VALIDATION_ERROR", "Invalid status scope. Use active or all.");
  }
  return scope;
}

async function list(req, res, next) {
  try {
    const products = await productsService.listProducts(parseListStatus(req.query), companyIdOf(req));
    return res.status(200).json({ success: true, data: products });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const product = await productsService.getProduct(req.params.id, parseDetailScope(req.query), companyIdOf(req));
    return res.status(200).json({ success: true, data: { product } });
  } catch (err) {
    return next(err);
  }
}

/**
 * Server-resolved tenant for catalog writes. The mounted companyContext
 * guarantees the value (or rejects the request first); a missing value
 * fails closed inside the service. Variant creation inherits the parent
 * product's company inside the service (never the request).
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function create(req, res, next) {
  try {
    const input = createProductSchema.parse(req.body);
    // Roles ride along for the Phase 3-2 active-state guard (ADMIN +
    // HEAD may write `isActive`; MEMBER may not). Snapshots use id.
    const product = await productsService.createProduct(companyIdOf(req), input, {
      id: req.user.id,
      roles: req.user.roles,
    });
    return res.status(201).json({ success: true, data: { product } });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const input = updateProductSchema.parse(req.body);
    const product = await productsService.updateProduct(req.params.id, companyIdOf(req), input, {
      id: req.user.id,
      roles: req.user.roles,
    });
    return res.status(200).json({ success: true, data: { product } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const product = await productsService.deactivateProduct(req.params.id, companyIdOf(req), { id: req.user.id });
    return res.status(200).json({ success: true, data: { product } });
  } catch (err) {
    return next(err);
  }
}

async function createVariant(req, res, next) {
  try {
    const input = createVariantSchema.parse(req.body);
    // Roles ride along for the Phase 3-3 active-state guard (ADMIN +
    // HEAD may write `isActive`; MEMBER may not). Snapshots use id.
    const variant = await productsService.createVariant(req.params.productId, companyIdOf(req), input, {
      id: req.user.id,
      roles: req.user.roles,
    });
    return res.status(201).json({ success: true, data: { variant } });
  } catch (err) {
    return next(err);
  }
}

async function updateVariant(req, res, next) {
  try {
    const input = updateVariantSchema.parse(req.body);
    const variant = await productsService.updateVariant(
      req.params.productId,
      req.params.variantId,
      companyIdOf(req),
      input,
      { id: req.user.id, roles: req.user.roles }
    );
    return res.status(200).json({ success: true, data: { variant } });
  } catch (err) {
    return next(err);
  }
}

async function removeVariant(req, res, next) {
  try {
    const variant = await productsService.deactivateVariant(req.params.productId, req.params.variantId, companyIdOf(req), {
      id: req.user.id,
    });
    return res.status(200).json({ success: true, data: { variant } });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  createVariant,
  updateVariant,
  removeVariant,
};
