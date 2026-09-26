const announcementsRepository = require("./announcements.repository");
const { AppError } = require("../../utils/appError");

function assertDateRange(startsAt, expiresAt) {
  if (startsAt && expiresAt && startsAt > expiresAt) {
    throw new AppError(
      422,
      "ANNOUNCEMENT_INVALID_DATE_RANGE",
      "expiresAt must be on or after startsAt"
    );
  }
}

async function listAnnouncementsAdmin() {
  return announcementsRepository.findAllAnnouncementsAdmin();
}

async function getAnnouncementAdmin(id) {
  const row = await announcementsRepository.findAnnouncementByIdAdmin(id);
  if (!row) {
    throw new AppError(404, "ANNOUNCEMENT_NOT_FOUND", "Announcement not found");
  }
  return row;
}

async function createAnnouncement(input, createdBy) {
  return announcementsRepository.createAnnouncement({ ...input, createdBy });
}

async function updateAnnouncement(id, input) {
  const current = await announcementsRepository.findAnnouncementByIdAdmin(id);
  if (!current) {
    throw new AppError(404, "ANNOUNCEMENT_NOT_FOUND", "Announcement not found");
  }
  const startsAt =
    input.startsAt !== undefined ? (input.startsAt ?? null) : (current.startsAt ?? null);
  const expiresAt =
    input.expiresAt !== undefined ? (input.expiresAt ?? null) : (current.expiresAt ?? null);
  assertDateRange(startsAt, expiresAt);
  return announcementsRepository.updateAnnouncement(id, input);
}

async function deleteAnnouncement(id) {
  const deleted = await announcementsRepository.deleteAnnouncement(id);
  if (!deleted) {
    throw new AppError(404, "ANNOUNCEMENT_NOT_FOUND", "Announcement not found");
  }
  return { id };
}

async function getCurrentAnnouncement(now = new Date()) {
  const row = await announcementsRepository.findCurrentAnnouncement(now);
  return { announcement: row ?? null };
}

module.exports = {
  listAnnouncementsAdmin,
  getAnnouncementAdmin,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getCurrentAnnouncement,
};
