const announcementsRepository = require("./announcements.repository");
const { AppError } = require("../../utils/appError");
const { resolveActorSnapshot, assertAuditInput, recordAuditEvent } = require("../audit/audit.service");

function assertDateRange(startsAt, expiresAt) {
  if (startsAt && expiresAt && startsAt > expiresAt) {
    throw new AppError(
      422,
      "ANNOUNCEMENT_INVALID_DATE_RANGE",
      "expiresAt must be on or after startsAt"
    );
  }
}

/**
 * Phase 2C-7 request guard (mirrors the orders service): company-scoped
 * announcement management needs the server-resolved companyId. The
 * public `getCurrentAnnouncement` takes no company by design (see the
 * documented CompanyDomain limitation).
 */
function assertRequestCompany(companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  return companyId;
}

/**
 * Phase 2C-17 broadcast audit (post-commit: single-write operations
 * with no transaction to join; recorded only after success). Titles
 * are public storefront content and safe metadata. Role restrictions
 * are untouched — these routes stay ADMIN-only.
 */
async function snapshotActor(actorId) {
  return actorId ? resolveActorSnapshot(actorId) : null;
}

function broadcastEvent(snapshot, companyId, action, resourceId, title) {
  return assertAuditInput({
    actorId: snapshot ? snapshot.id : null,
    actorRole: snapshot ? snapshot.role : "SYSTEM",
    actorEmail: snapshot ? snapshot.email : null,
    companyId,
    action,
    resource: "ANNOUNCEMENT",
    resourceId,
    outcome: "SUCCESS",
    details: title === undefined ? null : { title },
  });
}

async function listAnnouncementsAdmin(companyId) {
  assertRequestCompany(companyId);
  return announcementsRepository.findAllAnnouncementsAdmin(companyId);
}

async function getAnnouncementAdmin(companyId, id) {
  assertRequestCompany(companyId);
  const row = await announcementsRepository.findAnnouncementByIdAdmin(id, companyId);
  if (!row) {
    throw new AppError(404, "ANNOUNCEMENT_NOT_FOUND", "Announcement not found");
  }
  return row;
}

async function createAnnouncement(input, companyId, createdBy) {
  assertRequestCompany(companyId);
  const row = await announcementsRepository.createAnnouncement({ ...input, companyId, createdBy });
  await recordAuditEvent(broadcastEvent(await snapshotActor(createdBy), companyId, "CREATED", row.id, row.title));
  return row;
}

async function updateAnnouncement(companyId, id, input, actor = null) {
  assertRequestCompany(companyId);
  const current = await announcementsRepository.findAnnouncementByIdAdmin(id, companyId);
  if (!current) {
    throw new AppError(404, "ANNOUNCEMENT_NOT_FOUND", "Announcement not found");
  }
  const startsAt =
    input.startsAt !== undefined ? (input.startsAt ?? null) : (current.startsAt ?? null);
  const expiresAt =
    input.expiresAt !== undefined ? (input.expiresAt ?? null) : (current.expiresAt ?? null);
  assertDateRange(startsAt, expiresAt);
  const row = await announcementsRepository.updateAnnouncement(id, input);
  await recordAuditEvent(
    broadcastEvent(await snapshotActor(actor), companyId, "UPDATED", row.id, row.title ?? current.title)
  );
  return row;
}

async function deleteAnnouncement(companyId, id, actor = null) {
  assertRequestCompany(companyId);
  // Scoped pre-read first: company is immutable on these rows (no
  // reassignment path), so the check cannot race the delete below.
  const current = await getAnnouncementAdmin(companyId, id);
  const deleted = await announcementsRepository.deleteAnnouncement(id);
  if (!deleted) {
    throw new AppError(404, "ANNOUNCEMENT_NOT_FOUND", "Announcement not found");
  }
  await recordAuditEvent(broadcastEvent(await snapshotActor(actor), companyId, "DELETED", id, current.title));
  return { id };
}

/**
 * Phase 2C-12 public storefront rule: the current announcement
 * resolves within the domain company only. Unknown hosts fail closed
 * (404) instead of leaking another company's bar; a company with no
 * qualifying announcement keeps the legacy 200-null shape.
 */
async function getCurrentAnnouncement(companyId = null, now = new Date()) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(404, "ANNOUNCEMENT_NOT_FOUND", "Announcement not found");
  }
  const row = await announcementsRepository.findCurrentAnnouncement(companyId, now);
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
