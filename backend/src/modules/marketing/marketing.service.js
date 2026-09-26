const marketingRepository = require("./marketing.repository");
const { AppError } = require("../../utils/appError");

function assertDateRange(startsAt, expiresAt) {
  if (startsAt && expiresAt && startsAt > expiresAt) {
    throw new AppError(
      422,
      "MARKETING_INVALID_DATE_RANGE",
      "expiresAt must be on or after startsAt"
    );
  }
}

async function listMarketingAdmin() {
  return marketingRepository.findAllMarketingAdmin();
}

async function getMarketingAdmin(id) {
  const row = await marketingRepository.findMarketingByIdAdmin(id);
  if (!row) {
    throw new AppError(404, "MARKETING_NOT_FOUND", "Marketing notification not found");
  }
  return row;
}

async function createMarketing(input, createdBy) {
  return marketingRepository.createMarketing({ ...input, createdBy });
}

async function updateMarketing(id, input) {
  const current = await marketingRepository.findMarketingByIdAdmin(id);
  if (!current) {
    throw new AppError(404, "MARKETING_NOT_FOUND", "Marketing notification not found");
  }
  const startsAt =
    input.startsAt !== undefined ? (input.startsAt ?? null) : (current.startsAt ?? null);
  const expiresAt =
    input.expiresAt !== undefined ? (input.expiresAt ?? null) : (current.expiresAt ?? null);
  assertDateRange(startsAt, expiresAt);
  const data = { ...input };
  if (input.linkType === null) {
    data.linkValue = null;
  }
  return marketingRepository.updateMarketing(id, data);
}

async function deleteMarketing(id) {
  const deleted = await marketingRepository.deleteMarketing(id);
  if (!deleted) {
    throw new AppError(404, "MARKETING_NOT_FOUND", "Marketing notification not found");
  }
  return { id };
}

async function listActiveMarketing(now = new Date()) {
  return marketingRepository.findActiveMarketing(now);
}

module.exports = {
  listMarketingAdmin,
  getMarketingAdmin,
  createMarketing,
  updateMarketing,
  deleteMarketing,
  listActiveMarketing,
};
