const { AppError } = require("../../utils/appError");
const usersRepository = require("./users.repository");
const { toSafeUser } = require("./users.utils");
const { assertAuditInput, recordAuditEvent, resolveActorSnapshot } = require("../audit/audit.service");
const { ROLES, canManageRole } = require("../../config/permissions");
const { normalizeEmail, hashPassword } = require("../auth/auth.utils");

async function loadActiveUser(userId) {
  const user = await usersRepository.findUserById(userId);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  if (!user.isActive) {
    throw new AppError(403, "AUTH_ACCOUNT_INACTIVE", "Account is inactive");
  }
  return user;
}

async function getProfile(userId) {
  const user = await loadActiveUser(userId);
  return toSafeUser(user);
}

const ADMIN_DEFAULT_PAGE = 1;
const ADMIN_DEFAULT_LIMIT = 20;
const ADMIN_MAX_LIMIT = 100;

/**
 * Phase 2C-5 request guard (mirrors the orders/inventory services):
 * ADMIN customer-management needs the server-resolved companyId.
 */
function assertRequestCompany(companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  return companyId;
}

/**
 * Phase 2C-31 HEAD/MEMBER management guards.
 *
 * `isCompanyAdmin` preserves the exact ADMIN behavior on every shared
 * path: ADMIN callers never hit the MEMBER-target restriction below.
 * Route authorization already limits these paths to ADMIN + HEAD, so a
 * non-ADMIN actor here is always a HEAD (SUPER_ADMIN/MEMBER/CUSTOMER
 * are rejected by `authorize` before the service runs).
 */
function isCompanyAdmin(actorRoles) {
  return Array.isArray(actorRoles) && actorRoles.includes(ROLES.ADMIN);
}

/**
 * Restricts a resolved same-company user to an exactly-MEMBER target.
 * Anything else (HEAD, ADMIN, SUPER_ADMIN, CUSTOMER, roleless, or
 * multi-role rows) reads as missing: the neutral USER_NOT_FOUND keeps
 * unmanageable accounts indistinguishable from absent ones, so HEAD
 * callers get no existence oracle for accounts outside their remit.
 */
function assertMemberOnlyTarget(safeUser) {
  const names = Array.isArray(safeUser.roles) ? safeUser.roles : [];
  if (names.length !== 1 || names[0] !== ROLES.MEMBER) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
}

/**
 * Requires the actor to hold a role that manages MEMBER accounts
 * (ADMIN or HEAD, via the shared `canManageRole` hierarchy rule).
 * Defense-in-depth alongside route authorization: widening the route
 * later cannot silently widen management power.
 */
function assertMayManageMembers(actorRoles) {
  const roles = Array.isArray(actorRoles) ? actorRoles : [];
  const permitted = roles.some((role) => canManageRole(role, ROLES.MEMBER));
  if (!permitted) {
    throw new AppError(403, "AUTH_FORBIDDEN", "Insufficient permissions");
  }
}

async function listUsersAdmin(companyId, query, actorRoles = null) {
  assertRequestCompany(companyId);
  const page = query.page ?? ADMIN_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? ADMIN_DEFAULT_LIMIT, ADMIN_MAX_LIMIT);
  const search = query.search ? query.search.trim() : "";
  // Phase 2C-31 HEAD scoping: non-ADMIN callers (HEAD by route
  // authorization) see only the MEMBERs they may manage. ADMIN callers
  // keep the unfiltered company list exactly as before.
  const role = isCompanyAdmin(actorRoles) ? null : ROLES.MEMBER;
  const { rows, total } = await usersRepository.findUsersAdmin({
    companyId,
    search: search === "" ? null : search,
    isActive: query.isActive === undefined ? null : query.isActive === "true",
    role,
    sortBy: query.sortBy ?? "createdAt",
    sortOrder: query.sortOrder ?? "desc",
    skip: (page - 1) * limit,
    take: limit,
  });
  return {
    users: rows.map(toSafeUser),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function getUserAdmin(companyId, id, actorRoles = null) {
  assertRequestCompany(companyId);
  const user = await usersRepository.findUserByIdAndCompany(id, companyId);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  const safeUser = toSafeUser(user);
  // Phase 2C-31: HEAD callers resolve MEMBER targets only. ADMIN
  // callers keep the full same-company detail exactly as before.
  if (!isCompanyAdmin(actorRoles)) {
    assertMemberOnlyTarget(safeUser);
  }
  return safeUser;
}

/**
 * Phase 2C-14 audit instrumentation: `actorId` is the acting admin's
 * id (resolved to a snapshot; omit only for system calls). The event
 * is recorded AFTER the mutation succeeds — the explicitly
 * non-transactional pattern for single-write operations (a failed
 * mutation throws before any audit write, so no false records).
 */
async function setUserActiveAdmin(companyId, id, isActive, actorId = null, actorRoles = null) {
  assertRequestCompany(companyId);
  // Self-deactivation guard first (no read needed: the actor id always
  // belongs to the request company by construction, so id === actorId
  // can only ever be the caller's own row). Sole-ADMIN self-lockout
  // would brick the company's admin plane (login/refresh/me reject
  // inactive accounts, SUPER_ADMIN reset rotates passwords only, and
  // no reactivation path exists for a locked-out ADMIN); HEAD callers
  // get the same refusal. Self-reactivation stays allowed so a live
  // token can always repair state.
  if (isActive === false && typeof actorId === "string" && actorId !== "" && id === actorId) {
    throw new AppError(409, "USER_SELF_DEACTIVATION", "You cannot deactivate your own account");
  }
  // Scoped pre-read second: a foreign user reads as missing, so ban/
  // deactivate can never touch another company. User.companyId has no
  // reassignment API, so the check cannot race the write below. The
  // actor roles ride along so HEAD callers resolve MEMBER targets
  // only (Phase 2C-31); ADMIN callers keep the unrestricted pre-read.
  await getUserAdmin(companyId, id, actorRoles);
  try {
    const user = await usersRepository.setUserActive(id, isActive);
    const snapshot = actorId ? await resolveActorSnapshot(actorId) : null;
    await recordAuditEvent({
      actorId: snapshot ? snapshot.id : null,
      actorRole: snapshot ? snapshot.role : "SYSTEM",
      actorEmail: snapshot ? snapshot.email : null,
      companyId,
      action: isActive ? "REACTIVATED" : "DEACTIVATED",
      resource: "USER",
      resourceId: id,
      outcome: "SUCCESS",
      details: { isActive },
    });
    return toSafeUser(user);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }
    throw err;
  }
}

async function updateProfile(userId, input) {
  await loadActiveUser(userId);

  const data = {};
  if (input.firstName !== undefined) {
    data.firstName = input.firstName;
  }
  if (input.lastName !== undefined) {
    data.lastName = input.lastName;
  }
  if (input.phone !== undefined) {
    data.phone = input.phone;
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(422, "USER_UPDATE_INVALID", "No updatable fields provided");
  }

  try {
    const updated = await usersRepository.updateUserProfile(userId, data);
    return toSafeUser(updated);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }
    throw err;
  }
}

/**
 * Phase 2C-31 manager-driven MEMBER profile update (ADMIN + HEAD).
 *
 * This endpoint is MEMBER-only for every caller: no managed-profile
 * surface existed before, so ADMIN callers lose nothing and HEAD
 * callers gain exactly their remit (own-company MEMBERs). Email,
 * password, role, company, and active-state changes are NOT accepted
 * here — email changes stay deferred (§AK.9), passwords keep their
 * dedicated flows, roles move only through provisioning, and
 * `isActive` keeps the lifecycle endpoint. Nullable semantics mirror
 * the self-service `updateProfile` contract.
 */
async function updateMemberProfileAdmin(companyId, id, input, actor = null) {
  assertRequestCompany(companyId);
  const actorRoles = actor && Array.isArray(actor.roles) ? actor.roles : [];
  assertMayManageMembers(actorRoles);
  const current = await usersRepository.findUserByIdAndCompany(id, companyId);
  if (!current) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  assertMemberOnlyTarget(toSafeUser(current));

  const data = {};
  if (input.firstName !== undefined) {
    data.firstName = input.firstName;
  }
  if (input.lastName !== undefined) {
    data.lastName = input.lastName;
  }
  if (input.phone !== undefined) {
    data.phone = input.phone;
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(422, "USER_UPDATE_INVALID", "No updatable fields provided");
  }

  try {
    const updated = await usersRepository.updateUserProfile(id, data);
    // Phase 2C-17 pattern for single-write operations: audit AFTER the
    // mutation succeeds. Details carry the changed field NAMES as a
    // sorted comma-separated string — never values, passwords, or
    // other credential material (the audit writer rejects arrays).
    const snapshot = actor && actor.id ? await resolveActorSnapshot(actor.id) : null;
    await recordAuditEvent({
      actorId: snapshot ? snapshot.id : null,
      actorRole: snapshot ? snapshot.role : "SYSTEM",
      actorEmail: snapshot ? snapshot.email : null,
      companyId,
      action: "UPDATED",
      resource: "USER",
      resourceId: id,
      outcome: "SUCCESS",
      details: { fields: Object.keys(data).sort().join(",") },
    });
    return toSafeUser(updated);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }
    throw err;
  }
}

/**
 * Company-aware employee provisioning primitives (Phase 2B-1).
 *
 * These are INTERNAL service functions — no route exposes them yet, so
 * there is no request contract carrying companyId. When future APIs
 * call them, the company always derives from server-side state:
 * - ADMIN: the target Company row of the provisioning operation;
 * - HEAD/MEMBER: the authenticated creator's resolved company context
 *   (pass `creator = { id, companyId, roles }` explicitly, never req).
 *
 * CUSTOMER registration (public) and SUPER_ADMIN provisioning stay on
 * their existing/deferred paths and are rejected here.
 */

function assertProvisioningIdentity(input) {
  const email = typeof input.email === "string" ? normalizeEmail(input.email) : "";
  if (email === "" || email.length > 255) {
    throw new AppError(422, "USER_PROVISION_INVALID", "A valid email is required");
  }
  if (typeof input.password !== "string" || input.password.length < 8 || input.password.length > 128) {
    throw new AppError(422, "USER_PROVISION_INVALID", "Password must be 8-128 characters");
  }
  if (typeof input.firstName !== "string" || input.firstName.trim() === "") {
    throw new AppError(422, "USER_PROVISION_INVALID", "First name is required");
  }
  return {
    email,
    firstName: input.firstName.trim(),
    lastName: typeof input.lastName === "string" && input.lastName.trim() !== "" ? input.lastName.trim() : null,
    phone: typeof input.phone === "string" && input.phone.trim() !== "" ? input.phone.trim() : null,
  };
}

function isAdminAlreadyExistsConflict(err) {
  if (err.code !== "P2002") {
    return false;
  }
  const meta = err.meta || {};
  const target = Array.isArray(meta.target) ? meta.target.map(String).join(",").toLowerCase() : "";
  return target.includes("admin_user_id");
}

/**
 * Provisions the exactly-one ADMIN for an existing company and links
 * both sides (User.companyId + Company.adminUserId) atomically.
 * The caller identifies the company as an internal operation input —
 * never as an authoritative client field (no API exposes this yet).
 */
/**
 * Phase 2C-14 audit instrumentation: `actor` is an optional
 * `{ id }` identifying the provisioner (resolved to a snapshot);
 * omitted means system-provisioned. The audit payload is validated
 * BEFORE the transaction and written INSIDE it, so a rolled-back
 * provisioning leaves no audit row behind.
 */
async function provisionCompanyAdmin(companyId, input, actor = null) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(422, "USER_PROVISION_INVALID", "A target company is required");
  }
  const identity = assertProvisioningIdentity(input);

  const company = await usersRepository.findCompanyForProvisioning(companyId);
  if (!company) {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  }
  if (company.adminUserId) {
    throw new AppError(409, "COMPANY_ADMIN_EXISTS", "Company already has an ADMIN");
  }
  // Phase 2C-26 staff-identity invariant: an ADMIN email must be held
  // by no user anywhere (staff or customer, any company), keeping
  // staff login deterministic now that customers share emails across
  // companies. Previously enforced by the global email unique; the
  // P2002 mapping below stays as the race backstop.
  if (await usersRepository.emailUsedAnywhere(identity.email)) {
    throw new AppError(409, "USER_EMAIL_EXISTS", "Email is already registered");
  }

  const snapshot = actor && actor.id ? await resolveActorSnapshot(actor.id) : null;
  const audit = assertAuditInput({
    actorId: snapshot ? snapshot.id : null,
    actorRole: snapshot ? snapshot.role : "SYSTEM",
    actorEmail: snapshot ? snapshot.email : null,
    companyId,
    action: "CREATED",
    resource: "USER",
    outcome: "SUCCESS",
    details: { email: identity.email, role: "ADMIN", via: "provisioning" },
  });

  try {
    const user = await usersRepository.provisionCompanyAdminTx(
      companyId,
      {
        ...identity,
        passwordHash: await hashPassword(input.password),
      },
      {
        actorId: audit.actorId,
        actorRole: audit.actorRole,
        actorEmail: audit.actorEmail,
        action: audit.action,
        outcome: audit.outcome,
        details: audit.details,
      }
    );
    return toSafeUser(user);
  } catch (err) {
    if (isAdminAlreadyExistsConflict(err)) {
      throw new AppError(409, "COMPANY_ADMIN_EXISTS", "Company already has an ADMIN");
    }
    if (err.code === "P2002") {
      throw new AppError(409, "USER_EMAIL_EXISTS", "Email is already registered");
    }
    if (err.code === "P2025") {
      throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
    }
    throw err;
  }
}

const PROVISIONABLE_EMPLOYEE_ROLES = [ROLES.HEAD, ROLES.MEMBER];

/**
 * Creates a HEAD or MEMBER inheriting the creator's server-resolved
 * company. `creator` is `{ id, companyId, roles }` derived from the
 * authenticated context — never from request input. Any `companyId`
 * present on the input payload is destructured away and ignored, so a
 * mismatched value can never redirect tenancy (fail-closed by design
 * would also be acceptable; ignore-and-inherit keeps the internal
 * primitive total while remaining authoritative).
 */
async function provisionEmployee(creator, input) {
  const role = input.role;
  if (!PROVISIONABLE_EMPLOYEE_ROLES.includes(role)) {
    throw new AppError(
      422,
      "USER_PROVISION_INVALID",
      "Only HEAD or MEMBER can be provisioned through this operation"
    );
  }

  const creatorRoles = creator && Array.isArray(creator.roles) ? creator.roles : [];
  const creatorCompanyId =
    creator && typeof creator.companyId === "string" && creator.companyId !== ""
      ? creator.companyId
      : null;
  if (!creatorCompanyId) {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Creator has no resolved company");
  }
  const permitted = creatorRoles.some((creatorRole) => canManageRole(creatorRole, role));
  if (!permitted) {
    throw new AppError(403, "AUTH_FORBIDDEN", "Insufficient permissions");
  }

  const identity = assertProvisioningIdentity(input);

  // Phase 2C-26 staff-identity invariant (see provisionCompanyAdmin):
  // HEAD/MEMBER emails must be globally unused so staff identity
  // stays deterministic. The P2002 mapping below stays as the
  // same-company race backstop.
  if (await usersRepository.emailUsedAnywhere(identity.email)) {
    throw new AppError(409, "USER_EMAIL_EXISTS", "Email is already registered");
  }

  // Phase 2C-17: employee provisioning is audited in-transaction like
  // ADMIN provisioning (same exactly-once guarantee — a rolled-back
  // create leaves no audit row).
  const snapshot = creator && creator.id ? await resolveActorSnapshot(creator.id) : null;
  const audit = assertAuditInput({
    actorId: snapshot ? snapshot.id : null,
    actorRole: snapshot ? snapshot.role : "SYSTEM",
    actorEmail: snapshot ? snapshot.email : null,
    companyId: creatorCompanyId,
    action: "CREATED",
    resource: "USER",
    outcome: "SUCCESS",
    details: { email: identity.email, role, via: "provisioning" },
  });

  try {
    const user = await usersRepository.createUserWithCompanyRole(
      { ...identity, passwordHash: await hashPassword(input.password), companyId: creatorCompanyId },
      role,
      audit
    );
    return toSafeUser(user);
  } catch (err) {
    if (err.code === "P2002") {
      throw new AppError(409, "USER_EMAIL_EXISTS", "Email is already registered");
    }
    throw err;
  }
}

/**
 * First platform SUPER_ADMIN provisioning (operator CLI bootstrap —
 * never an HTTP endpoint). Creates exactly one SUPER_ADMIN row:
 * platform-scoped (`companyId: null`), single `SUPER_ADMIN` role link,
 * Argon2id hash, active per User defaults. Creates nothing else: no
 * Company, no CompanyDomain, no ADMIN/CUSTOMER, no extra roles.
 *
 * Idempotency and type safety over the global email space (staff
 * identity stays deterministic per the Phase 2C-26 invariant):
 * - unknown email → create (`{ user, created: true }`), audited
 *   in-transaction (actor SYSTEM — no creator exists; details carry
 *   email/role/via only, never secrets).
 * - active exactly-SUPER_ADMIN email → no-op success
 *   (`{ user, created: false }`): no duplicate, no password change,
 *   no audit row (no mutation occurred).
 * - email held by any other role mix → 409, never elevated.
 * - inactive holder (any role, SUPER_ADMIN included) → 403, never
 *   reactivated or elevated.
 */
async function provisionSuperAdmin(input) {
  const rawEmail = typeof input?.email === "string" ? input.email : "";
  const email = normalizeEmail(rawEmail);
  // Same shape as the auth `emailSchema` (trimmed, lowercased, RFC-style,
  // ≤255): the CLI validates identically before calling; this guard keeps
  // the service safe for any future caller.
  if (email === "" || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(422, "USER_PROVISION_INVALID", "A valid email is required");
  }
  const password = input?.password;
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new AppError(422, "USER_PROVISION_INVALID", "Password must be 8-128 characters");
  }

  const existing = await usersRepository.findUsersByEmail(email);
  if (existing.length > 0) {
    const current = toSafeUser(existing[0]);
    if (!existing[0].isActive) {
      throw new AppError(403, "AUTH_ACCOUNT_INACTIVE", "Email is already registered to a deactivated account");
    }
    const names = Array.isArray(current.roles) ? current.roles : [];
    if (names.length === 1 && names[0] === ROLES.SUPER_ADMIN) {
      return { user: current, created: false };
    }
    throw new AppError(409, "USER_EMAIL_EXISTS", "Email is already registered and is not a platform SUPER_ADMIN");
  }

  const audit = assertAuditInput({
    actorId: null,
    actorRole: "SYSTEM",
    actorEmail: null,
    companyId: null,
    action: "CREATED",
    resource: "USER",
    outcome: "SUCCESS",
    details: { email, role: ROLES.SUPER_ADMIN, via: "bootstrap" },
  });

  try {
    const row = await usersRepository.createUserWithCompanyRole(
      {
        email,
        passwordHash: await hashPassword(password),
        firstName: null,
        lastName: null,
        phone: null,
        companyId: null,
      },
      ROLES.SUPER_ADMIN,
      audit
    );
    return { user: toSafeUser(row), created: true };
  } catch (err) {
    if (err.code === "P2002") {
      throw new AppError(409, "USER_EMAIL_EXISTS", "Email is already registered");
    }
    throw err;
  }
}

module.exports = {
  getProfile,
  updateProfile,
  listUsersAdmin,
  getUserAdmin,
  setUserActiveAdmin,
  updateMemberProfileAdmin,
  provisionCompanyAdmin,
  provisionEmployee,
  provisionSuperAdmin,
};
