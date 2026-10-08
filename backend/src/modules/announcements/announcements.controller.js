const announcementsService = require("./announcements.service");
const {
  announcementIdParamSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} = require("./announcements.validation");

async function getCurrent(req, res, next) {
  try {
    const { announcement } = await announcementsService.getCurrentAnnouncement(companyIdOf(req));
    return res.status(200).json({ success: true, data: { announcement } });
  } catch (err) {
    return next(err);
  }
}

/**
 * Server-resolved tenant for announcement management. The public
 * `getCurrent` intentionally takes no company (global until
 * CompanyDomain resolution — documented limitation). A missing value
 * on admin paths fails closed inside the service.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function listAdmin(req, res, next) {
  try {
    const announcements = await announcementsService.listAnnouncementsAdmin(companyIdOf(req));
    return res.status(200).json({ success: true, data: { announcements } });
  } catch (err) {
    return next(err);
  }
}

async function getByIdAdmin(req, res, next) {
  try {
    const params = announcementIdParamSchema.parse({ id: req.params.id });
    const announcement = await announcementsService.getAnnouncementAdmin(companyIdOf(req), params.id);
    return res.status(200).json({ success: true, data: { announcement } });
  } catch (err) {
    return next(err);
  }
}

async function createAdmin(req, res, next) {
  try {
    const input = createAnnouncementSchema.parse(req.body);
    const announcement = await announcementsService.createAnnouncement(
      input,
      companyIdOf(req),
      req.user?.id ?? null
    );
    return res.status(201).json({ success: true, data: { announcement } });
  } catch (err) {
    return next(err);
  }
}

async function updateAdmin(req, res, next) {
  try {
    const params = announcementIdParamSchema.parse({ id: req.params.id });
    const input = updateAnnouncementSchema.parse(req.body);
    const announcement = await announcementsService.updateAnnouncement(companyIdOf(req), params.id, input, req.user?.id ?? null);
    return res.status(200).json({ success: true, data: { announcement } });
  } catch (err) {
    return next(err);
  }
}

async function deleteAdmin(req, res, next) {
  try {
    const params = announcementIdParamSchema.parse({ id: req.params.id });
    const result = await announcementsService.deleteAnnouncement(companyIdOf(req), params.id, req.user?.id ?? null);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getCurrent, listAdmin, getByIdAdmin, createAdmin, updateAdmin, deleteAdmin };
