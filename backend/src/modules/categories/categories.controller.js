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

async function list(req, res, next) {
  try {
    const categories = await categoriesService.listCategories(parseListStatus(req.query));
    return res.status(200).json({ success: true, data: categories });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const category = await categoriesService.getCategory(req.params.id, parseDetailScope(req.query));
    return res.status(200).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const input = createCategorySchema.parse(req.body);
    const category = await categoriesService.createCategory(input);
    return res.status(201).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const input = updateCategorySchema.parse(req.body);
    const category = await categoriesService.updateCategory(req.params.id, input);
    return res.status(200).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const category = await categoriesService.deactivateCategory(req.params.id);
    return res.status(200).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

async function uploadImage(req, res, next) {
  try {
    const category = await categoriesService.uploadCategoryImage(req.params.id, req.file);
    return res.status(200).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

async function removeImage(req, res, next) {
  try {
    const category = await categoriesService.removeCategoryImage(req.params.id);
    return res.status(200).json({ success: true, data: { category } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, remove, uploadImage, removeImage };
