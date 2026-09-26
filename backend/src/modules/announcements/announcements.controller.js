const announcementsService = require("./announcements.service");
const {
  announcementIdParamSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} = require("./announcements.validation");

async function getCurrent(req, res, next) {
  try {
    const { announcement } = await announcementsService.getCurrentAnnouncement();
    return res.status(200).json({ success: true, data: { announcement } });
  } catch (err) {
    return next(err);
  }
}

async function listAdmin(req, res, next) {
  try {
    const announcements = await announcementsService.listAnnouncementsAdmin();
    return res.status(200).json({ success: true, data: { announcements } });
  } catch (err) {
    return next(err);
  }
}

async function getByIdAdmin(req, res, next) {
  try {
    const params = announcementIdParamSchema.parse({ id: req.params.id });
    const announcement = await announcementsService.getAnnouncementAdmin(params.id);
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
    const announcement = await announcementsService.updateAnnouncement(params.id, input);
    return res.status(200).json({ success: true, data: { announcement } });
  } catch (err) {
    return next(err);
  }
}

async function deleteAdmin(req, res, next) {
  try {
    const params = announcementIdParamSchema.parse({ id: req.params.id });
    const result = await announcementsService.deleteAnnouncement(params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getCurrent, listAdmin, getByIdAdmin, createAdmin, updateAdmin, deleteAdmin };
