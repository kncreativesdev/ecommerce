const marketingService = require("./marketing.service");
const {
  marketingIdParamSchema,
  createMarketingSchema,
  updateMarketingSchema,
} = require("./marketing.validation");

async function listAdmin(req, res, next) {
  try {
    const notifications = await marketingService.listMarketingAdmin();
    return res.status(200).json({ success: true, data: { notifications } });
  } catch (err) {
    return next(err);
  }
}

async function getByIdAdmin(req, res, next) {
  try {
    const params = marketingIdParamSchema.parse({ id: req.params.id });
    const notification = await marketingService.getMarketingAdmin(params.id);
    return res.status(200).json({ success: true, data: { notification } });
  } catch (err) {
    return next(err);
  }
}

async function createAdmin(req, res, next) {
  try {
    const input = createMarketingSchema.parse(req.body);
    const notification = await marketingService.createMarketing(input, req.user?.id ?? null);
    return res.status(201).json({ success: true, data: { notification } });
  } catch (err) {
    return next(err);
  }
}

async function updateAdmin(req, res, next) {
  try {
    const params = marketingIdParamSchema.parse({ id: req.params.id });
    const input = updateMarketingSchema.parse(req.body);
    const notification = await marketingService.updateMarketing(params.id, input);
    return res.status(200).json({ success: true, data: { notification } });
  } catch (err) {
    return next(err);
  }
}

async function deleteAdmin(req, res, next) {
  try {
    const params = marketingIdParamSchema.parse({ id: req.params.id });
    const result = await marketingService.deleteMarketing(params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

async function listActive(req, res, next) {
  try {
    const notifications = await marketingService.listActiveMarketing();
    return res.status(200).json({ success: true, data: { notifications } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listAdmin, getByIdAdmin, createAdmin, updateAdmin, deleteAdmin, listActive };
