const marketingService = require("./marketing.service");
const {
  marketingIdParamSchema,
  createMarketingSchema,
  updateMarketingSchema,
} = require("./marketing.validation");

/**
 * Server-resolved tenant for broadcast operations. The mounted
 * companyContext guarantees the value (or rejects the request first);
 * a missing value fails closed inside the service.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function listAdmin(req, res, next) {
  try {
    const notifications = await marketingService.listMarketingAdmin(companyIdOf(req));
    return res.status(200).json({ success: true, data: { notifications } });
  } catch (err) {
    return next(err);
  }
}

async function getByIdAdmin(req, res, next) {
  try {
    const params = marketingIdParamSchema.parse({ id: req.params.id });
    const notification = await marketingService.getMarketingAdmin(companyIdOf(req), params.id);
    return res.status(200).json({ success: true, data: { notification } });
  } catch (err) {
    return next(err);
  }
}

async function createAdmin(req, res, next) {
  try {
    const input = createMarketingSchema.parse(req.body);
    const notification = await marketingService.createMarketing(input, companyIdOf(req), req.user?.id ?? null);
    return res.status(201).json({ success: true, data: { notification } });
  } catch (err) {
    return next(err);
  }
}

async function updateAdmin(req, res, next) {
  try {
    const params = marketingIdParamSchema.parse({ id: req.params.id });
    const input = updateMarketingSchema.parse(req.body);
    const notification = await marketingService.updateMarketing(companyIdOf(req), params.id, input, req.user?.id ?? null);
    return res.status(200).json({ success: true, data: { notification } });
  } catch (err) {
    return next(err);
  }
}

async function deleteAdmin(req, res, next) {
  try {
    const params = marketingIdParamSchema.parse({ id: req.params.id });
    const result = await marketingService.deleteMarketing(companyIdOf(req), params.id, req.user?.id ?? null);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

async function listActive(req, res, next) {
  try {
    const notifications = await marketingService.listActiveMarketing(companyIdOf(req));
    return res.status(200).json({ success: true, data: { notifications } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listAdmin, getByIdAdmin, createAdmin, updateAdmin, deleteAdmin, listActive };
