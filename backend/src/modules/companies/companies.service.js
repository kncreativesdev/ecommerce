const { AppError } = require("../../utils/appError");
const { logger } = require("../../utils/logger");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const companiesRepository = require("./companies.repository");
const usersService = require("../users/users.service");
const usersRepository = require("../users/users.repository");
const { toSafeUser } = require("../users/users.utils");
const { hashPassword } = require("../auth/auth.utils");
const { assertAuditInput, resolveActorSnapshot } = require("../audit/audit.service");
const { normalizeHostname } = require("../../middleware/companyContext");
const { localStorageAdapter, UPLOADS_ROOT } = require("../media/storage/local.storage");
const { processToWebp, assertRasterImage, IMAGE_TYPE } = require("../media/imageProcessing");

const COMPANY_DEFAULT_PAGE = 1;
const COMPANY_DEFAULT_LIMIT = 20;
const COMPANY_MAX_LIMIT = 100;

// Company #1 — the original Tech Pulse store seeded by migration
// 20261002075021_phase1_company_foundation and prisma/seed.js — is
// permanently protected from deletion by stable UUID (never by name,
// which a future feature may allow changing).
const COMPANY_ONE_ID = "35b5a215-0cf3-42db-ba42-6fac6656a708";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toSafeCompany(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    adminProvisioned: row.adminUserId !== null && row.adminUserId !== undefined,
    googleSignInEnabled: row.googleSignInEnabled ?? true,
    domains: (row.domains || []).map((domain) => ({
      id: domain.id,
      domain: domain.domain,
      isPrimary: domain.isPrimary,
      isActive: domain.isActive,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Business profile fields (Phase 2C-33): the only PATCH-settable keys
// besides `name`. `logoPath` is deliberately absent — the dedicated
// logo endpoints stamp it server-side and PATCH can never write it.
const PROFILE_FIELDS = Object.freeze([
  "contactEmail",
  "contactPhone",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  "website",
]);

function toSafeCompanyDetail(row) {
  return {
    ...toSafeCompany(row),
    contactEmail: row.contactEmail ?? null,
    contactPhone: row.contactPhone ?? null,
    addressLine1: row.addressLine1 ?? null,
    addressLine2: row.addressLine2 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    postalCode: row.postalCode ?? null,
    country: row.country ?? null,
    website: row.website ?? null,
    logoPath: row.logoPath ?? null,
  };
}

/**
 * HTTPS-only website gate (service-level, beside `normalizeHostname`).
 * Rejects javascript:, data:, http:, and malformed URLs with
 * COMPANY_INVALID_WEBSITE (mirroring COMPANY_DOMAIN_INVALID) rather
 * than a generic validation error.
 */
function isHttpsWebsite(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 500 || /\s/.test(trimmed)) {
    return false;
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  return url.protocol === "https:";
}

/**
 * Resolves the calling SUPER_ADMIN to an audit actor snapshot. The id
 * comes from the authenticated request (authorize() already gated the
 * role); the snapshot itself is read fresh so later changes cannot
 * rewrite history.
 */
async function resolvePlatformActor(actor) {
  if (!actor || typeof actor.id !== "string" || actor.id === "") {
    throw new AppError(401, "AUTH_UNAUTHORIZED", "Authentication required");
  }
  return resolveActorSnapshot(actor.id);
}

function platformAudit(snapshot, action, details) {
  return assertAuditInput({
    actorId: snapshot.id,
    actorRole: snapshot.role,
    actorEmail: snapshot.email,
    companyId: null,
    action,
    resource: "COMPANY",
    outcome: "SUCCESS",
    details: details ?? null,
  });
}

async function listCompanies(query) {
  const page = query.page ?? COMPANY_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? COMPANY_DEFAULT_LIMIT, COMPANY_MAX_LIMIT);
  const search = query.search ? query.search.trim() : "";
  const { rows, total } = await companiesRepository.findCompaniesAdmin({
    search: search === "" ? null : search,
    status: query.status ?? null,
    skip: (page - 1) * limit,
    take: limit,
  });
  return {
    companies: rows.map(toSafeCompany),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function getCompany(id) {
  const row = await companiesRepository.findCompanyById(id);
  if (!row) {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  const aggregates = await companiesRepository.getCompanyAggregates(id);
  return { ...toSafeCompanyDetail(row), aggregates };
}

/**
 * Platform summary (SUPER_ADMIN dashboard). Aggregate-only: company
 * counts by status, summed platform totals, and lean per-company rows
 * (identity + primary domain + displayed counts). No operational rows
 * (products, orders, customers, inventory, reviews, carts,
 * notifications, audit contents) are selected or returned anywhere in
 * this path, and profile/timestamp/domain-array width never enters
 * the response — payload scales with company count alone.
 */
async function getPlatformSummary() {
  const [rows, counts] = await Promise.all([
    companiesRepository.findAllCompaniesForSummary(),
    companiesRepository.getPlatformAggregateCounts(),
  ]);
  const at = (map, id) => map.get(id) ?? 0;
  // Lean per-company rows: exactly the dashboard contract (identity +
  // primary domain string + displayed counts). Profile columns,
  // timestamps, full domain arrays, and non-displayed counts never
  // leave this layer, so response size scales with company count
  // alone — not with profile/domain/aggregate width.
  const perCompany = rows.map((row) => {
    const domains = Array.isArray(row.domains) ? row.domains : [];
    const primary = domains.find((entry) => entry.isPrimary) ?? domains[0];
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      primaryDomain: primary ? primary.domain : null,
      aggregates: {
        totalUsers: at(counts.users, row.id),
        totalProducts: at(counts.products, row.id),
        totalOrders: at(counts.orders, row.id),
      },
    };
  });
  // Platform totals stay exact (identical to summing per-company
  // counts, including the role breakdowns no longer emitted per
  // company) by summing the grouped database counts directly.
  const sumCounts = (map) => {
    let total = 0;
    for (const value of map.values()) {
      total += value;
    }
    return total;
  };
  const totals = {
    totalUsers: sumCounts(counts.users),
    totalCustomers: sumCounts(counts.customers),
    totalHeads: sumCounts(counts.heads),
    totalMembers: sumCounts(counts.members),
    totalProducts: sumCounts(counts.products),
    totalOrders: sumCounts(counts.orders),
  };
  const countFor = (status) => counts.statusGroups.find((entry) => entry.status === status)?.count ?? 0;
  return {
    totalCompanies: rows.length,
    activeCompanies: countFor("ACTIVE"),
    suspendedCompanies: countFor("SUSPENDED"),
    totals,
    companies: perCompany,
  };
}

/**
 * Company metadata update (SUPER_ADMIN rename). The `name` column is
 * the established mutable metadata field: lifecycle state moves
 * through suspend/restore, googleSignInEnabled and domains through
 * their dedicated endpoints, ADMIN identity through
 * provisioning/reset — none are accepted or touched here (strict
 * validation rejects them before this layer). Same-name writes are a
 * no-op success with no audit event (domain no-op convention);
 * genuine renames record a company-scoped COMPANY/UPDATED event with
 * the previous value (purges with the company like domain rows) and
 * return the full safe detail shape.
 */
async function updateCompany(companyId, input, actor) {
  const snapshot = await resolvePlatformActor(actor);
  const target = await companiesRepository.findCompanyById(companyId);
  if (!target) {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  // Normalized patch: `name` keeps its required/non-empty rule when
  // supplied; profile fields arrive pre-normalized from validation
  // (trimmed, email lowercased, empty string already NULL for clear).
  const patch = {};
  if (input.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name === "" || name.length > 255) {
      throw new AppError(422, "COMPANY_INVALID_NAME", "Company name is required");
    }
    patch.name = name;
  }
  for (const field of PROFILE_FIELDS) {
    if (input[field] !== undefined) {
      patch[field] = input[field];
    }
  }
  if (patch.website !== undefined && patch.website !== null && !isHttpsWebsite(patch.website)) {
    throw new AppError(422, "COMPANY_INVALID_WEBSITE", "Website must be a valid HTTPS URL");
  }
  const changedFields = Object.keys(patch).filter((field) => {
    const current = field === "name" ? target.name : (target[field] ?? null);
    return patch[field] !== current;
  });
  if (changedFields.length === 0) {
    return getCompany(companyId);
  }
  const previousValues = {};
  for (const field of changedFields) {
    previousValues[field] = field === "name" ? target.name : (target[field] ?? null);
  }
  const audit = companySettingAudit(snapshot, companyId, "UPDATED", { changedFields, previousValues });
  const result = await companiesRepository.updateCompanyRecordTx({ companyId, data: patch, audit });
  if (result.outcome === "missing") {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  return getCompany(companyId);
}

/**
 * Company logo upload (SUPER_ADMIN platform configuration). Reuses the
 * established raster-only pipeline (multer MIME/extension gate at the
 * route, Sharp content verification + WebP conversion here) and the
 * company-prefixed storage convention
 * (`companies/<companyId>/branding/`, mirroring the product/category
 * subtrees). The server generates and stamps `logoPath`; clients can
 * never supply it. The previous file is removed only after the new
 * file persists AND the database update commits (warn-only cleanup —
 * the DB is the source of truth).
 */
async function setCompanyLogo(companyId, file, actor) {
  const snapshot = await resolvePlatformActor(actor);
  const target = await companiesRepository.findCompanyById(companyId);
  if (!target) {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new AppError(400, "MEDIA_UPLOAD_FAILED", "No image file uploaded");
  }
  await assertRasterImage(file.buffer);
  const webpBuffer = await processToWebp(file.buffer);
  const filename = `${crypto.randomUUID()}.${IMAGE_TYPE}`;
  const relativeDir = `companies/${companyId}/branding`;
  let storagePath;
  try {
    storagePath = await localStorageAdapter.save(relativeDir, filename, webpBuffer);
  } catch (err) {
    logger.error({ err: err.message }, "Company logo storage write failed");
    throw new AppError(500, "MEDIA_STORAGE_FAILED", "Image storage failed");
  }
  const previousLogoPath = target.logoPath ?? null;
  const audit = companySettingAudit(snapshot, companyId, "UPDATED", { logoOperation: "uploaded" });
  const result = await companiesRepository.setCompanyLogoTx({ companyId, logoPath: storagePath, audit });
  if (result.outcome === "missing") {
    try {
      await localStorageAdapter.remove(storagePath);
    } catch (err) {
      logger.warn("Orphaned company logo cleanup failed after raced company deletion");
    }
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  if (previousLogoPath && previousLogoPath !== storagePath) {
    try {
      await localStorageAdapter.remove(previousLogoPath);
    } catch (err) {
      logger.warn("Previous company logo cleanup failed after replacement");
    }
  }
  return getCompany(companyId);
}

/**
 * Company logo removal (SUPER_ADMIN platform configuration).
 * Idempotent — a company with no logo returns unchanged. The column
 * clears transactionally with the audit row; the file removal follows
 * post-commit (warn-only). Never accepts client paths: only the
 * server-stamped `logoPath` is ever removed.
 */
async function clearCompanyLogo(companyId, actor) {
  const snapshot = await resolvePlatformActor(actor);
  const target = await companiesRepository.findCompanyById(companyId);
  if (!target) {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  if (!target.logoPath) {
    return getCompany(companyId);
  }
  const previousLogoPath = target.logoPath;
  const audit = companySettingAudit(snapshot, companyId, "UPDATED", { logoOperation: "removed" });
  const result = await companiesRepository.setCompanyLogoTx({ companyId, logoPath: null, audit });
  if (result.outcome === "missing") {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  try {
    await localStorageAdapter.remove(previousLogoPath);
  } catch (err) {
    logger.warn("Company logo file cleanup failed after metadata deletion");
  }
  return getCompany(companyId);
}

async function createCompany(input, actor) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name === "" || name.length > 255) {
    throw new AppError(422, "COMPANY_INVALID_NAME", "Company name is required");
  }
  const snapshot = await resolvePlatformActor(actor);
  const audit = platformAudit(snapshot, "CREATED", { name });
  const row = await companiesRepository.createCompanyRecord(name, audit);
  return toSafeCompany(row);
}

async function suspendCompany(id, actor) {
  const snapshot = await resolvePlatformActor(actor);
  const audit = platformAudit(snapshot, "SUSPENDED", null);
  const result = await companiesRepository.transitionCompanyStatus(id, "ACTIVE", "SUSPENDED", audit);
  if (result.outcome === "missing") {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  if (result.outcome === "conflict") {
    throw new AppError(409, "COMPANY_ALREADY_SUSPENDED", "Company is already suspended");
  }
  return getCompany(id);
}

async function restoreCompany(id, actor) {
  const snapshot = await resolvePlatformActor(actor);
  const audit = platformAudit(snapshot, "RESTORED", null);
  const result = await companiesRepository.transitionCompanyStatus(id, "SUSPENDED", "ACTIVE", audit);
  if (result.outcome === "missing") {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  if (result.outcome === "conflict") {
    throw new AppError(409, "COMPANY_ALREADY_ACTIVE", "Company is already active");
  }
  return getCompany(id);
}

/**
 * Phase 2C-15 provisioning boundary: delegates to the existing atomic
 * users-service primitive (exactly-one ADMIN, both sides linked, its
 * own in-transaction audit event). This layer adds nothing except the
 * platform audit attribution, which the primitive already records
 * from the passed actor. Credential management stays deferred.
 */
async function provisionAdmin(companyId, input, actor) {
  const snapshot = await resolvePlatformActor(actor);
  return usersService.provisionCompanyAdmin(companyId, input, { id: snapshot.id });
}

/**
 * Phase 2C-16 platform credential reset: rotates the password of the
 * company's DESIGNATED admin only. The target derives exclusively
 * from the route company id via Company.adminUserId — no user id is
 * accepted from the client, so cross-company targeting is
 * structurally impossible. Password-only by design (login-identifier
 * changes are deferred, documented in MULTI_COMPANY_SAAS.md §AK):
 * roles are never touched and no second ADMIN can result (nothing is
 * created here). Refresh sessions predating the rotation die via the
 * credential watermark.
 */
async function resetAdminPassword(companyId, input, actor) {
  const snapshot = await resolvePlatformActor(actor);
  const company = await usersRepository.findCompanyForProvisioning(companyId);
  if (!company) {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  if (!company.adminUserId) {
    throw new AppError(404, "COMPANY_ADMIN_NOT_FOUND", "Company has no ADMIN yet");
  }
  const admin = await usersRepository.findUserById(company.adminUserId);
  const roleNames = (admin && Array.isArray(admin.roles) ? admin.roles : [])
    .filter((link) => link && link.role)
    .map((link) => link.role.name);
  if (!admin || admin.companyId !== company.id || !roleNames.includes("ADMIN")) {
    // Fail closed: dangling or cross-company adminUserId never resolves
    // to a password write on a foreign account.
    throw new AppError(409, "COMPANY_ADMIN_INCONSISTENT", "Company ADMIN association is invalid");
  }
  const audit = assertAuditInput({
    actorId: snapshot.id,
    actorRole: snapshot.role,
    actorEmail: snapshot.email,
    companyId: company.id,
    action: "UPDATED",
    resource: "USER",
    outcome: "SUCCESS",
    details: { email: admin.email, via: "super-admin-reset" },
  });
  const updated = await usersRepository.resetUserPasswordTx({
    userId: admin.id,
    companyId: company.id,
    passwordHash: await hashPassword(input.password),
    passwordChangedAt: new Date(),
    audit,
  });
  return toSafeUser(updated);
}

/**
 * Phase 2C-20 permanent company deletion (SUPER_ADMIN only).
 *
 * Fail-before-destruction order: missing → protected (#1, by UUID) →
 * not-suspended → confirmation mismatch. Only a SUSPENDED company
 * whose exact current name is confirmed is destroyed. The name
 * comparison is case-sensitive server-side equality — the UUID is
 * never an acceptable substitute.
 *
 * Atomicity: all tenant rows plus the company row die in one
 * transaction ending in a guarded conditional delete (id +
 * still-SUSPENDED + same name), so a concurrent restore — or a
 * racing second delete — rolls everything back instead of
 * partially deleting. Filesystem media follows after commit
 * (warn-only; the database is the source of truth — see below).
 */
async function deleteCompany(id, confirmName, actor) {
  const snapshot = await resolvePlatformActor(actor);
  const target = await companiesRepository.findCompanyDeletionTarget(id);
  if (!target) {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  if (target.id === COMPANY_ONE_ID) {
    throw new AppError(403, "COMPANY_PROTECTED", "This company is protected and cannot be deleted");
  }
  if (target.status !== "SUSPENDED") {
    throw new AppError(409, "COMPANY_NOT_SUSPENDED", "Company must be suspended before permanent deletion");
  }
  if (typeof confirmName !== "string" || confirmName !== target.name) {
    throw new AppError(422, "COMPANY_CONFIRMATION_MISMATCH", "Confirmation name does not match the company name");
  }

  const mediaPaths = await companiesRepository.findCompanyMediaPaths(target.id);
  // Platform-level deletion audit (companyId NULL — outside the
  // deleted company's scope, so the company cascade below cannot
  // remove it). Only the UUID + name are recorded: no customer,
  // order, credential, or payload material of any kind.
  const audit = platformAudit(snapshot, "DELETED", { companyId: target.id, companyName: target.name });
  const result = await companiesRepository.deleteCompanyCascadeTx({ id: target.id, name: target.name, audit });
  if (result.outcome === "missing") {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }

  await removeCompanyMedia(target.id, mediaPaths);
  return { id: target.id, name: target.name };
}

/**
 * Post-commit media reclamation (Phase 2C-20). Removes the database-
 * referenced image files plus the whole `companies/{companyId}`
 * subtree (new company-scoped writes). Legacy flat paths are covered
 * because only the company's own collected references are removed —
 * nothing shared is ever touched. Warn-only by design: the committed
 * database deletion is authoritative, and a missing file is not a
 * failure. Documented limitation: filesystem removal is NOT part of
 * the database transaction (a crash between commit and cleanup can
 * leave orphaned bytes, which carry no database references).
 */
async function removeCompanyMedia(companyId, mediaPaths) {
  if (!UUID_PATTERN.test(companyId)) {
    logger.warn("Skipping company media cleanup for non-UUID company id");
    return;
  }
  for (const relativePath of mediaPaths) {
    try {
      await localStorageAdapter.remove(relativePath);
    } catch (err) {
      logger.warn("Company media file cleanup failed after company deletion");
    }
  }
  try {
    const tree = path.join(UPLOADS_ROOT, "companies", companyId);
    const resolved = path.resolve(tree);
    if (resolved !== UPLOADS_ROOT && resolved.startsWith(UPLOADS_ROOT + path.sep)) {
      await fs.rm(resolved, { recursive: true, force: true });
    }
  } catch (err) {
    logger.warn("Company media subtree cleanup failed after company deletion");
  }
}

/**
 * Bounded deadlock-victim retry (Phase 2C-27). Concurrent primary
 * promotions lock the same sibling rows in opposite orders, so MySQL
 * may abort one transaction with 1213 (surfaced as Prisma P2034 with
 * the explicit "retry your transaction" guidance). Retrying the whole
 * transaction is safe: rolled-back attempts persist nothing,
 * including their audit row. Serial attempts keep the
 * exactly-one-primary outcome deterministic (last-writer-wins).
 */
async function withWriteRetry(operation) {
  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (!err || err.code !== "P2034" || attempt >= MAX_ATTEMPTS) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}

function toSafeDomain(row) {
  return {
    id: row.id,
    domain: row.domain,
    isPrimary: row.isPrimary,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Domain-registry audit attribution (Phase 2C-27). Unlike the
 * platform-level company lifecycle events (companyId NULL), domain
 * mutations are scoped to the owning company — company-scoped audit
 * rows are purged with the company on permanent deletion (§AO),
 * while the platform DELETED record survives. Details carry only the
 * canonical hostname plus the toggled flags: no secrets exist in
 * this surface. Only successful mutations are recorded (the row
 * commits inside the mutation transaction); failures throw before
 * any audit write, per the established mutation-wide policy.
 */
function domainAudit(snapshot, companyId, action, details) {
  return assertAuditInput({
    actorId: snapshot.id,
    actorRole: snapshot.role,
    actorEmail: snapshot.email,
    companyId,
    action,
    resource: "COMPANY_DOMAIN",
    outcome: "SUCCESS",
    details: details ?? null,
  });
}

/**
 * Company-setting audit (Phase 4-4). Same shape as domainAudit but
 * resource COMPANY: a company-scoped mutation of company-owned
 * configuration (purges with the company like domain rows).
 */
function companySettingAudit(snapshot, companyId, action, details) {
  return assertAuditInput({
    actorId: snapshot.id,
    actorRole: snapshot.role,
    actorEmail: snapshot.email,
    companyId,
    action,
    resource: "COMPANY",
    outcome: "SUCCESS",
    details: details ?? null,
  });
}

/**
 * Loads the target company for domain management or fails with the
 * shared 404. Ownership always derives from this route company id —
 * the strict validation schemas reject any body-supplied companyId,
 * and the domain row's own companyId is compared against it below,
 * so cross-company mutation is structurally impossible.
 */
async function requireDomainCompany(companyId) {
  const company = await companiesRepository.findCompanyDeletionTarget(companyId);
  if (!company) {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  return company;
}

async function requireOwnedDomain(companyId, domainId) {
  const row = await companiesRepository.findCompanyDomainById(domainId);
  if (!row || row.companyId !== companyId) {
    // Neutral 404 for both missing and foreign rows: no existence
    // oracle across companies (same convention as ownership-scoped
    // resources, which return 404 rather than 403).
    throw new AppError(404, "COMPANY_DOMAIN_NOT_FOUND", "Company domain not found");
  }
  return row;
}

/**
 * Phase 2C-27 domain listing. Read-only platform metadata for the
 * route company — no operational data, no audit event for reads.
 */
async function listCompanyDomains(companyId, actor) {
  await resolvePlatformActor(actor);
  const company = await requireDomainCompany(companyId);
  const rows = await companiesRepository.findCompanyDomains(company.id);
  return { domains: rows.map(toSafeDomain) };
}

/**
 * Phase 2C-27 domain registration. The raw value is canonicalized
 * through the SAME `normalizeHostname` used by runtime resolution —
 * no second normalization exists. Rejections: unknown company (404),
 * unmappable value (422 COMPANY_DOMAIN_INVALID: empty, over-long,
 * URL/scheme/path/credential/UUID forms), already-registered
 * canonical hostname anywhere (409 COMPANY_DOMAIN_EXISTS, with the
 * global unique as the concurrent-registration race backstop).
 *
 * Suspended companies may gain domains: registration only writes the
 * registry — `requireActiveCompany` stays the authoritative
 * suspension gate on the request path, so a new active domain on a
 * suspended company still resolves to a blocked storefront.
 */
async function createCompanyDomain(companyId, input, actor) {
  const snapshot = await resolvePlatformActor(actor);
  const company = await requireDomainCompany(companyId);
  const canonical = normalizeHostname(input.domain);
  if (!canonical) {
    throw new AppError(422, "COMPANY_DOMAIN_INVALID", "Domain must be a valid hostname without protocol or path");
  }
  const taken = await companiesRepository.findCompanyDomainByName(canonical);
  if (taken) {
    throw new AppError(409, "COMPANY_DOMAIN_EXISTS", "Domain is already registered");
  }
  const audit = domainAudit(snapshot, company.id, "CREATED", { domain: canonical });
  try {
    const result = await withWriteRetry(() =>
      companiesRepository.createCompanyDomainTx({ companyId: company.id, domain: canonical, audit })
    );
    return toSafeDomain(result.domain);
  } catch (err) {
    if (err && err.code === "P2002") {
      throw new AppError(409, "COMPANY_DOMAIN_EXISTS", "Domain is already registered");
    }
    throw err;
  }
}

/**
 * Phase 2C-27 domain state update (`isActive` and/or `isPrimary`).
 * Promotion is atomic (demote-siblings + promote-target in one
 * transaction — concurrent promotions leave exactly one primary)
 * and idempotent (promoting the current primary re-affirms it).
 * Demoting a primary without promoting another is rejected (409
 * COMPANY_DOMAIN_PRIMARY_REQUIRED); demoting a non-primary is a
 * no-op success. Pure active-state no-ops return the current row
 * without an audit event (no mutation occurred). Active/inactive is
 * orthogonal to primary: deactivating keeps the primary flag, so
 * reactivation restores routing with no promotion needed — and a
 * deactivated domain stops resolving publicly per the unchanged
 * resolver while company data is untouched. Suspension never gates
 * here (see createCompanyDomain).
 */
async function updateCompanyDomain(companyId, domainId, input, actor) {
  const snapshot = await resolvePlatformActor(actor);
  const company = await requireDomainCompany(companyId);
  const row = await requireOwnedDomain(company.id, domainId);

  if (input.isPrimary === false && row.isPrimary === true) {
    throw new AppError(
      409,
      "COMPANY_DOMAIN_PRIMARY_REQUIRED",
      "The primary domain cannot be demoted without promoting another domain first"
    );
  }

  const wantsPromote = input.isPrimary === true;
  const wantsActiveChange = input.isActive !== undefined && input.isActive !== row.isActive;

  if (!wantsPromote && !wantsActiveChange) {
    return toSafeDomain(row);
  }

  const details = { domain: row.domain };
  if (wantsPromote) {
    details.isPrimary = true;
  }
  if (wantsActiveChange) {
    details.isActive = input.isActive;
  }
  const audit = domainAudit(snapshot, company.id, "UPDATED", details);

  if (wantsPromote) {
    const result = await withWriteRetry(() =>
      companiesRepository.promoteCompanyDomainTx({
        companyId: company.id,
        domainId: row.id,
        isActive: wantsActiveChange ? input.isActive : undefined,
        audit,
      })
    );
    return toSafeDomain(result.domain);
  }
  const result = await withWriteRetry(() =>
    companiesRepository.setCompanyDomainActiveTx({
      domainId: row.id,
      isActive: input.isActive,
      audit,
    })
  );
  return toSafeDomain(result.domain);
}

/**
 * Phase 2C-27 domain removal. Only a non-primary — or the sole
 * remaining domain — may be removed; deleting a primary while
 * siblings exist is rejected (409 COMPANY_DOMAIN_IS_PRIMARY: promote
 * another first). Removal deletes only the registry row (audited);
 * the company, its users, and all operational data are untouched.
 * Permanent company deletion continues through the existing
 * company-deletion cascade (§AO) — no second cleanup exists here.
 */
async function deleteCompanyDomain(companyId, domainId, actor) {
  const snapshot = await resolvePlatformActor(actor);
  const company = await requireDomainCompany(companyId);
  const row = await requireOwnedDomain(company.id, domainId);
  const audit = domainAudit(snapshot, company.id, "DELETED", { domain: row.domain });
  const result = await withWriteRetry(() =>
    companiesRepository.deleteCompanyDomainTx({
      companyId: company.id,
      domainId: row.id,
      audit,
    })
  );
  if (result.outcome === "missing") {
    throw new AppError(404, "COMPANY_DOMAIN_NOT_FOUND", "Company domain not found");
  }
  if (result.outcome === "primary-blocked") {
    throw new AppError(
      409,
      "COMPANY_DOMAIN_IS_PRIMARY",
      "The primary domain cannot be removed while other domains exist. Promote another domain first"
    );
  }
  return { id: row.id, domain: row.domain };
}

/**
 * Phase 4-4 Google sign-in allowlist management (SUPER_ADMIN only,
 * platform chain — same posture as domain management: suspended
 * companies stay manageable, and ownership derives from the route
 * company id with strict validation rejecting body companyId).
 * Audit is company-scoped (COMPANY/UPDATED) like domain mutations;
 * the row commits inside the update transaction.
 */
async function setGoogleSignIn(companyId, input, actor) {
  const snapshot = await resolvePlatformActor(actor);
  const company = await requireDomainCompany(companyId);
  const current = await companiesRepository.findCompanyGoogleSignIn(company.id);
  const audit = companySettingAudit(snapshot, company.id, "UPDATED", {
    googleSignInEnabled: input.enabled,
    previousValue: current ? current.googleSignInEnabled : null,
  });
  const result = await companiesRepository.setGoogleSignInTx({
    companyId: company.id,
    enabled: input.enabled,
    audit,
  });
  if (result.outcome === "missing") {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  return getCompany(company.id);
}

module.exports = {
  listCompanies,
  getCompany,
  getPlatformSummary,
  createCompany,
  updateCompany,
  setCompanyLogo,
  clearCompanyLogo,
  suspendCompany,
  restoreCompany,
  provisionAdmin,
  resetAdminPassword,
  deleteCompany,
  listCompanyDomains,
  createCompanyDomain,
  updateCompanyDomain,
  deleteCompanyDomain,
  setGoogleSignIn,
};
