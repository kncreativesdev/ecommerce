const { AppError } = require("../../utils/appError");
const categoriesService = require("./categories.service");
const { createCategorySchema, updateCategorySchema } = require("./categories.validation");

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

/**
 * Server-resolved tenant. Public reads carry no companyContext (null →
 * unscoped global catalog, exactly as before); the mounted admin
 * branch supplies the company for inactive/all reads. Mutations fail
 * closed on null inside the service.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function list(req, res, next) {
  try {
    const categories = await categoriesService.listCategories(parseListStatus(req.query), companyIdOf(req));
    return res.status(200).json({ success: true, data: categories });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const category = await categoriesService.getCategory(req.params.id, parseDetailScope(req.query), companyIdOf(req));
    return res.status(200).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

/**
 * Server-resolved tenant for catalog writes. The mounted companyContext
 * guarantees the value (or rejects the request first); a missing value
 * fails closed inside the service.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function create(req, res, next) {
  try {
    const input = createCategorySchema.parse(req.body);
    // Roles ride along for the Phase 3-1 active-state guard (ADMIN +
    // HEAD may write `isActive`; MEMBER may not). Snapshots use id.
    const category = await categoriesService.createCategory(companyIdOf(req), input, {
      id: req.user.id,
      roles: req.user.roles,
    });
    return res.status(201).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const input = updateCategorySchema.parse(req.body);
    const category = await categoriesService.updateCategory(req.params.id, companyIdOf(req), input, {
      id: req.user.id,
      roles: req.user.roles,
    });
    return res.status(200).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const category = await categoriesService.deactivateCategory(req.params.id, companyIdOf(req), { id: req.user.id });
    return res.status(200).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

async function uploadImage(req, res, next) {
  try {
    const category = await categoriesService.uploadCategoryImage(req.params.id, companyIdOf(req), req.file, {
      id: req.user.id,
    });
    return res.status(200).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

async function removeImage(req, res, next) {
  try {
    const category = await categoriesService.removeCategoryImage(req.params.id, companyIdOf(req), { id: req.user.id });
    return res.status(200).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, remove, uploadImage, removeImage };
