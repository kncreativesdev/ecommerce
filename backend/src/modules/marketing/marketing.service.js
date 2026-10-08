const marketingRepository = require("./marketing.repository");
const { AppError } = require("../../utils/appError");
const { findCategoryById } = require("../categories/categories.repository");
const { findProductById } = require("../products/products.repository");
const { findCouponByCode } = require("../coupons/coupons.repository");
const { resolveActorSnapshot, assertAuditInput, recordAuditEvent } = require("../audit/audit.service");

/**
 * Phase 2C-7 request guard (mirrors the orders service): company-scoped
 * broadcast operations need the server-resolved companyId.
 */
function assertRequestCompany(companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  return companyId;
}

/**
 * Link-target company check: CATEGORY/PRODUCT/COUPON destinations must
 * resolve inside the author's company, else they fail exactly like
 * missing targets (the value is the caller's own input). SHOP and
 * null targets need no check.
 */
async function assertLinkTarget(linkType, linkValue, companyId) {
  if (!linkType || linkValue === null || linkValue === undefined) {
    return;
  }
  if (linkType === "SHOP") {
    return;
  }
  if (linkType === "CATEGORY") {
    const category = await findCategoryById(linkValue, companyId);
    if (!category) {
      throw new AppError(404, "CATEGORY_NOT_FOUND", "Linked category not found");
    }
    return;
  }
  if (linkType === "PRODUCT") {
    const product = await findProductById(linkValue, companyId);
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Linked product not found");
    }
    return;
  }
  if (linkType === "COUPON") {
    const coupon = await findCouponByCode(String(linkValue).trim().toUpperCase());
    if (!coupon || coupon.companyId !== companyId) {
      throw new AppError(404, "COUPON_NOT_FOUND", "Linked coupon not found");
    }
  }
}

function assertDateRange(startsAt, expiresAt) {
  if (startsAt && expiresAt && startsAt > expiresAt) {
    throw new AppError(
      422,
      "MARKETING_INVALID_DATE_RANGE",
      "expiresAt must be on or after startsAt"
    );
  }
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
    resource: "MARKETING",
    resourceId,
    outcome: "SUCCESS",
    details: title === undefined ? null : { title },
  });
}

async function listMarketingAdmin(companyId) {
  assertRequestCompany(companyId);
  return marketingRepository.findAllMarketingAdmin(companyId);
}

async function getMarketingAdmin(companyId, id) {
  assertRequestCompany(companyId);
  const row = await marketingRepository.findMarketingByIdAdmin(id, companyId);
  if (!row) {
    throw new AppError(404, "MARKETING_NOT_FOUND", "Marketing notification not found");
  }
  return row;
}

async function createMarketing(input, companyId, createdBy) {
  assertRequestCompany(companyId);
  await assertLinkTarget(input.linkType ?? null, input.linkValue ?? null, companyId);
  const row = await marketingRepository.createMarketing({ ...input, companyId, createdBy });
  await recordAuditEvent(broadcastEvent(await snapshotActor(createdBy), companyId, "CREATED", row.id, row.title));
  return row;
}

async function updateMarketing(companyId, id, input, actor = null) {
  assertRequestCompany(companyId);
  const current = await marketingRepository.findMarketingByIdAdmin(id, companyId);
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
  // Effective link pair (incoming fields over the scoped current row):
  // retargeting to another company's entity fails like a missing one.
  if (input.linkType !== undefined || input.linkValue !== undefined) {
    const effectiveType = input.linkType !== undefined ? input.linkType : current.linkType;
    const effectiveValue = input.linkValue !== undefined ? input.linkValue : current.linkValue;
    await assertLinkTarget(effectiveType ?? null, effectiveValue ?? null, companyId);
  }
  const row = await marketingRepository.updateMarketing(id, data);
  await recordAuditEvent(
    broadcastEvent(await snapshotActor(actor), companyId, "UPDATED", row.id, row.title ?? current.title)
  );
  return row;
}

async function deleteMarketing(companyId, id, actor = null) {
  assertRequestCompany(companyId);
  // Scoped pre-read first: company is immutable on these rows (no
  // reassignment path), so the check cannot race the delete below.
  const current = await getMarketingAdmin(companyId, id);
  const deleted = await marketingRepository.deleteMarketing(id);
  if (!deleted) {
    throw new AppError(404, "MARKETING_NOT_FOUND", "Marketing notification not found");
  }
  await recordAuditEvent(broadcastEvent(await snapshotActor(actor), companyId, "DELETED", id, current.title));
  return { id };
}

async function listActiveMarketing(companyId, now = new Date()) {
  assertRequestCompany(companyId);
  return marketingRepository.findActiveMarketing(companyId, now);
}

module.exports = {
  listMarketingAdmin,
  getMarketingAdmin,
  createMarketing,
  updateMarketing,
  deleteMarketing,
  listActiveMarketing,
};
