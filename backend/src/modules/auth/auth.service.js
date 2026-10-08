const crypto = require("crypto");

const { AppError } = require("../../utils/appError");
const { signAccessToken, signRefreshToken, verifyRefreshToken, refreshSessionMeta } = require("../../utils/jwt");
const { env } = require("../../config/env");
const authRepository = require("./auth.repository");
const passwordResetRepository = require("./passwordReset.repository");
const { sendOtpEmail } = require("../../config/mailer");
const { assertAuditInput, resolveActorSnapshot } = require("../audit/audit.service");
const { verifyGoogleIdToken } = require("./auth.google");
const companiesRepository = require("../companies/companies.repository");
const {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  toSafeUser,
} = require("./auth.utils");

function issueTokenPair(user) {
  return issueTokenPairWithSession(user);
}

/**
 * SHA-256 over the refresh token `jti`. The `jti` is a random session
 * identifier, not the token itself (useless without the server signing
 * secret); hashing keeps even identifiers out of plaintext storage.
 * Fast non-password hash is correct here: the input has 128 bits of
 * entropy, unlike human passwords (Argon2id stays for those).
 */
function refreshSessionKey(jti) {
  return crypto.createHash("sha256").update(jti, "utf8").digest("hex");
}

/**
 * Mints the session pair and persists the refresh session in the same
 * flow, so every issued refresh token has a server-side record keyed
 * by its `jti` from birth. Async by necessity (database write);
 * callers are all async services.
 */
async function issueTokenPairWithSession(user) {
  const safeUser = toSafeUser(user);
  const accessToken = signAccessToken(safeUser);
  const refreshToken = signRefreshToken(safeUser.id);
  const meta = refreshSessionMeta(refreshToken);
  // Invariant: our own minter always stamps `jti`/`exp`. Fail closed
  // rather than issuing an untracked session.
  if (!meta) {
    throw new AppError(500, "AUTH_SESSION_ERROR", "Could not establish a refresh session");
  }
  await authRepository.createRefreshSessionTx({
    userId: safeUser.id,
    jtiHash: refreshSessionKey(meta.jti),
    expiresAt: meta.expiresAt,
  });
  return { user: safeUser, accessToken, refreshToken };
}

/**
 * Phase 2C-26 company-scoped customer identity. `User.email` is unique
 * per (companyId, email) — never globally — so email-keyed flows
 * resolve CANDIDATES and disambiguate deterministically:
 *
 * - Staff identity (SUPER_ADMIN/ADMIN/HEAD/MEMBER) stays globally
 *   unique by application invariant (every staff creation path
 *   rejects an email held by any user), so at most one staff row
 *   ever carries an email.
 * - Within one company an email maps to at most one user (compound
 *   unique), so domain-scoped resolution is unambiguous.
 * - The request domain (server-resolved Host → company, never a
 *   client-supplied companyId) selects the company scope; the
 *   password then decides between the company row and the staff row
 *   when both exist. Unscoped requests (unregistered hosts: admin
 *   panel, localhost, legacy) keep the legacy single-identity
 *   behavior and fail closed on ambiguity.
 */
const STAFF_ROLES = Object.freeze(["SUPER_ADMIN", "ADMIN", "HEAD", "MEMBER"]);

function roleNamesOf(user) {
  return (user && Array.isArray(user.roles) ? user.roles : [])
    .filter((link) => link && link.role)
    .map((link) => link.role.name);
}

function isStaffUser(user) {
  return roleNamesOf(user).some((name) => STAFF_ROLES.includes(name));
}

/**
 * Ordered password attempts over identity candidates. Returns the
 * first row whose password verifies, else null. The response is
 * always the neutral invalid-credentials error — which candidate
 * existed (or whether several did) is never revealed.
 */
async function tryCandidatesPassword(candidates, password) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (await verifyPassword(candidate.passwordHash, password)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Login candidates for (email, companyId). Scoped requests try the
 * company row first (correct-domain session wins even when the same
 * email + password exists elsewhere), then the global staff row
 * (staff login works from any host, exactly as before). Unscoped
 * requests try the staff row, else the single non-staff row when
 * there is exactly one (legacy behavior); zero or ambiguous
 * non-staff rows fail closed with no candidates.
 */
function resolveLoginCandidates(rows, companyId) {
  const scoped = typeof companyId === "string" && companyId !== "" ? companyId : null;
  if (scoped) {
    const companyUser = rows.find((row) => row.companyId === scoped) ?? null;
    const staffUser = rows.find((row) => isStaffUser(row) && row.id !== companyUser?.id) ?? null;
    return [companyUser, staffUser].filter(Boolean);
  }
  const staffUser = rows.find((row) => isStaffUser(row)) ?? null;
  if (staffUser) {
    return [staffUser];
  }
  const others = rows.filter((row) => !isStaffUser(row));
  if (others.length === 1) {
    return [others[0]];
  }
  return [];
}

/**
 * Phase 2C-13 session gate: a user whose owning company is SUSPENDED
 * cannot start or renew a session. Checked server-side from the live
 * row on every login/refresh/Google sign-in, so pre-suspension tokens
 * cannot bypass it and JWT claims stay untouched. Users without a
 * company (platform identities, legacy unassigned accounts) pass
 * through — suspension only ever blocks a resolved SUSPENDED company.
 */
function assertCompanyActive(user) {
  if (user && user.company && user.company.status === "SUSPENDED") {
    throw new AppError(403, "COMPANY_SUSPENDED", "Company operations are unavailable while the company is suspended");
  }
}

/**
 * Phase 2C-11: `companyId` is the server-resolved domain company (or
 * null when the host is unregistered, preserving legacy behavior).
 * Callers must never forward request-body companyId here — the
 * register schema strips unknown fields and this parameter defaults
 * to null.
 *
 * Phase 2C-26 scoped uniqueness: a domain-scoped registration
 * succeeds when (company, email) is free — the same email may
 * already exist in other companies. It is rejected only when the
 * email is taken *in this company* (staff or customer alike, so one
 * company never holds two identities for one email). Unscoped
 * (legacy) registration keeps global semantics: any existing row
 * with the email rejects. The P2002 mapping below stays as the
 * same-company race backstop.
 */
async function register(input, companyId = null) {
  const email = normalizeEmail(input.email);
  const scoped = typeof companyId === "string" && companyId !== "" ? companyId : null;
  const clash = scoped
    ? await authRepository.findUserByEmailAndCompany(email, scoped)
    : (await authRepository.findUsersByEmail(email))[0] ?? null;
  if (clash) {
    throw new AppError(409, "AUTH_EMAIL_ALREADY_EXISTS", "Email is already registered");
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const user = await authRepository.createUserWithRole(
      {
        email,
        passwordHash,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        phone: input.phone ?? null,
        companyId: scoped,
      },
      "CUSTOMER"
    );
    return toSafeUser(user);
  } catch (err) {
    if (err.code === "P2002") {
      throw new AppError(409, "AUTH_EMAIL_ALREADY_EXISTS", "Email is already registered");
    }
    throw err;
  }
}

async function login(input, companyId = null) {
  const email = normalizeEmail(input.email);
  const rows = await authRepository.findUsersByEmail(email);
  const user = await tryCandidatesPassword(resolveLoginCandidates(rows, companyId), input.password);

  if (!user) {
    throw new AppError(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (!user.isActive) {
    throw new AppError(403, "AUTH_ACCOUNT_INACTIVE", "Account is inactive");
  }
  assertCompanyActive(user);

  return issueTokenPair(user);
}

function invalidRefreshTokenError() {
  return new AppError(401, "AUTH_REFRESH_TOKEN_INVALID", "Refresh token is missing or invalid");
}

/**
 * One-time refresh-token rotation. The presented token must verify
 * (signature + expiry) AND resolve to a live server-side session row
 * (present, unrevoked, unexpired, owned by `sub`). Consumption is a
 * single conditional database update, so concurrent consumers of the
 * same `jti` serialize: exactly one wins, losers get the neutral
 * invalid-token error. The winner's old row is revoked before the
 * successor pair is minted. User/company/watermark gates keep their
 * existing codes and order (fail closed without burning sessions on
 * dead accounts).
 */
async function refresh(refreshToken) {
  if (typeof refreshToken !== "string" || refreshToken === "") {
    throw invalidRefreshTokenError();
  }

  const result = verifyRefreshToken(refreshToken);
  if (!result.ok || typeof result.payload.sub !== "string" || typeof result.payload.jti !== "string") {
    throw invalidRefreshTokenError();
  }
  const { sub, jti } = result.payload;

  const user = await authRepository.findUserById(sub);
  if (!user || !user.isActive) {
    throw invalidRefreshTokenError();
  }
  assertCompanyActive(user);
  // Phase 2C-16 credential watermark: refresh tokens minted before the
  // last password change are rejected with the same neutral code.
  if (isRefreshTokenStale(result.payload, user)) {
    throw invalidRefreshTokenError();
  }

  const consumed = await authRepository.consumeRefreshSession({
    userId: sub,
    jtiHash: refreshSessionKey(jti),
    now: new Date(),
  });
  if (!consumed) {
    // Unknown, expired, revoked, replayed, or foreign session row:
    // identical neutral response, no existence oracle.
    throw invalidRefreshTokenError();
  }

  return issueTokenPair(user);
}

async function getMe(userId) {
  const user = await authRepository.findUserById(userId);
  if (!user) {
    throw new AppError(401, "AUTH_UNAUTHORIZED", "Authentication required");
  }
  return toSafeUser(user);
}

/**
 * Logout revokes the presented refresh-token session server-side
 * (idempotent), in addition to the controller clearing the browser
 * cookie. Missing, malformed, or already-revoked tokens still
 * answer success — anonymous logout and double-logout stay 200.
 */
async function logout(refreshToken) {
  if (typeof refreshToken === "string" && refreshToken !== "") {
    const result = verifyRefreshToken(refreshToken);
    if (result.ok && typeof result.payload.sub === "string" && typeof result.payload.jti === "string") {
      await authRepository.revokeRefreshSession({
        userId: result.payload.sub,
        jtiHash: refreshSessionKey(result.payload.jti),
      });
    }
  }
  return { message: "Logged out successfully" };
}

function clipName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, 100);
}

/**
 * Google sign-in (Google Identity Services ID-token flow). Verifies the
 * token with Google (no new dependencies — Node crypto + fetch), then
 * mints the SAME session pair as password login. Existing accounts link
 * by verified email; new accounts are created as CUSTOMER with an
 * unusable random password hash (password login can never succeed for
 * them) and the names Google provides. Inactive accounts stay blocked.
 *
 * Phase 2C-26 scoped linking: the verified email resolves within the
 * request's domain company first (the company's own row — staff or
 * customer — links, so each company's Google users stay separate),
 * then the global staff row (staff Google linking works from any
 * host, as before). Unscoped requests keep the legacy behavior
 * (staff, else the single non-staff row, else create) and fail
 * closed with AUTH_GOOGLE_AMBIGUOUS_IDENTITY when the email maps to
 * several non-staff rows — the holder proved email ownership, so
 * directing them to their company storefront reveals nothing new.
 * No per-company Google client config exists (P.6 allowlist never
 * implemented); the domain company is the only scoping signal.
 * Phase 4-4 company allowlist: Google sign-in is permitted only when
 * the resolved company's `googleSignInEnabled` flag is true. The check
 * runs before token verification and before any linking/creation, so a
 * disabled company creates nobody, touches nobody, and reveals nothing
 * beyond the denial itself. It applies to the whole scoped flow
 * (customer and staff rows alike — the flow never distinguished them,
 * and bifurcating it would punch a hole through the fail-closed
 * design). Unscoped legacy requests carry no company and are
 * unaffected. Suspension/inactive gating below is unchanged, as is the
 * middleware suspension gate that runs first.
 */
async function loginWithGoogle(idToken, companyId = null) {
  const clientId = typeof env.googleClientId === "string" ? env.googleClientId.trim() : "";
  if (clientId === "") {
    throw new AppError(503, "AUTH_GOOGLE_NOT_CONFIGURED", "Google sign-in is not configured");
  }
  const scoped = typeof companyId === "string" && companyId !== "" ? companyId : null;
  if (scoped) {
    const allowlist = await companiesRepository.findCompanyGoogleSignIn(scoped);
    if (!allowlist || allowlist.googleSignInEnabled !== true) {
      // Fail closed (missing company included): identical response for
      // disabled and dangling companies — no existence oracle.
      throw new AppError(403, "AUTH_GOOGLE_NOT_ALLOWED", "Google sign-in is not enabled for this company");
    }
  }
  const claims = await verifyGoogleIdToken(idToken, clientId);
  const email = normalizeEmail(claims.email);

  const linkScoped = async () => authRepository.findUserByEmailAndCompany(email, scoped);
  const linkUnscoped = async () => {
    const rows = await authRepository.findUsersByEmail(email);
    const staffUser = rows.find((row) => isStaffUser(row)) ?? null;
    if (staffUser) {
      return staffUser;
    }
    const others = rows.filter((row) => !isStaffUser(row));
    if (others.length === 1) {
      return others[0];
    }
    if (others.length === 0) {
      return null;
    }
    throw new AppError(
      409,
      "AUTH_GOOGLE_AMBIGUOUS_IDENTITY",
      "This email has accounts in several companies. Sign in from your company storefront instead."
    );
  };

  let user = scoped ? await linkScoped() : await linkUnscoped();
  if (!user && scoped) {
    const rows = await authRepository.findUsersByEmail(email);
    user = rows.find((row) => isStaffUser(row)) ?? null;
  }
  if (!user) {
    const passwordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
    try {
      user = await authRepository.createUserWithRole(
        {
          email,
          passwordHash,
          firstName: clipName(claims.given_name),
          lastName: clipName(claims.family_name),
          phone: null,
          companyId: scoped,
        },
        "CUSTOMER"
      );
    } catch (err) {
      if (err.code === "P2002") {
        // Registration race: another request created the account first.
        user = scoped ? await linkScoped() : await linkUnscoped();
      } else {
        throw err;
      }
    }
  }
  if (!user) {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token is invalid");
  }
  if (!user.isActive) {
    throw new AppError(403, "AUTH_ACCOUNT_INACTIVE", "Account is inactive");
  }
  assertCompanyActive(user);

  return issueTokenPair(user);
}

/**
 * Phase 2C-16 credential recovery + change (OTP-based).
 *
 * Design notes (see MULTI_COMPANY_SAAS.md §K):
 * - Email is unique per (company, email) (Phase 2C-26), so the public
 *   recovery flows resolve their target through the request's domain
 *   company (`resolveRecoveryTarget`) exactly like login does. No
 *   client company selector exists anywhere here — tenancy is never
 *   an input. Ambiguous unscoped emails resolve to no target, with
 *   the identical uniform response.
 * - Forgot-password initiation always answers the same 200 message so
 *   account existence is never revealed. Dummy Argon2id work on the
 *   no-user path keeps timing uniform with the real path.
 * - Codes are 6 digits from crypto.randomInt; only Argon2id hashes
 *   persist. Issuing a code supersedes older ones; success consumes
 *   (usedAt); attempts are bounded (OTP_MAX_ATTEMPTS); expiry is
 *   enforced on every use.
 * - PASSWORD_RESET completes in two steps (verify, then reset with
 *   the code re-supplied — no extra token type invented).
 *   PASSWORD_CHANGE verifies inline in the single authenticated call.
 * - Every rotation sets passwordChangedAt, which the refresh flow
 *   enforces (isRefreshTokenStale) — pre-rotation refresh tokens die
 *   at next use. Access tokens stay valid until their short expiry
 *   (documented residual).
 * - Audit carries actor snapshots and safe metadata only — never
 *   passwords, hashes, codes, or tokens (the audit writer rejects
 *   secret-bearing keys/values regardless).
 */
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const FORGOT_RESPONSE_MESSAGE = "If an account exists for this email, a verification code has been sent.";

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function otpExpiresAt() {
  return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
}

function isOtpUsable(row) {
  return (
    row !== null &&
    row !== undefined &&
    !row.usedAt &&
    row.expiresAt instanceof Date &&
    row.expiresAt.getTime() > Date.now() &&
    row.attempts < OTP_MAX_ATTEMPTS
  );
}

/**
 * Stateless refresh revocation watermark. Second-granularity on both
 * sides: tokens minted in the same second as the rotation stay valid
 * (they postdate it at the only precision JWT carries), older ones
 * die. A watermarked account whose token carries no iat fails closed.
 */
function isRefreshTokenStale(payload, user) {
  if (!user || !user.passwordChangedAt) {
    return false;
  }
  const iatSec = payload && typeof payload.iat === "number" ? payload.iat : null;
  if (iatSec === null) {
    return true;
  }
  const watermarkSec = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
  return iatSec < watermarkSec;
}

function isResetEligible(user) {
  return Boolean(user && user.isActive && !(user.company && user.company.status === "SUSPENDED"));
}

async function issueOtpFor(user, purpose) {
  const otp = generateOtp();
  const otpHash = await hashPassword(otp);
  await passwordResetRepository.invalidateActiveOtps(user.id, purpose);
  await passwordResetRepository.createOtp({
    userId: user.id,
    purpose,
    otpHash,
    expiresAt: otpExpiresAt(),
  });
  return otp;
}

function invalidOtpError() {
  return new AppError(400, "AUTH_OTP_INVALID", "Invalid or expired verification code");
}

/**
 * Phase 2C-26 recovery target resolution. The company/domain context
 * is part of customer identity: scoped requests address the single
 * (company, email) row (staff or customer — one company never holds
 * two rows for one email), so a reset for Company A can never touch
 * Company B. Unscoped requests keep the legacy behavior (the staff
 * row, else the single non-staff row) and resolve to NO target when
 * the email maps to several non-staff rows — the uniform response is
 * identical either way, so cross-company existence is never
 * revealed. OTP rows are keyed by userId, so a code issued for one
 * company's account can never verify against another's even if
 * presented there: the derived target (hence the userId) differs.
 */
async function resolveRecoveryTarget(email, companyId = null) {
  const scoped = typeof companyId === "string" && companyId !== "" ? companyId : null;
  if (scoped) {
    return authRepository.findUserByEmailAndCompany(email, scoped);
  }
  const rows = await authRepository.findUsersByEmail(email);
  const staffUser = rows.find((row) => isStaffUser(row)) ?? null;
  if (staffUser) {
    return staffUser;
  }
  const others = rows.filter((row) => !isStaffUser(row));
  return others.length === 1 ? others[0] : null;
}

async function requestPasswordReset(email, companyId = null) {
  const normalized = normalizeEmail(email);
  const user = await resolveRecoveryTarget(normalized, companyId);
  // Dummy hash when no code is issued — uniform work, no existence oracle.
  const otpHash = await hashPassword(generateOtp());
  void otpHash;
  if (isResetEligible(user)) {
    const otp = await issueOtpFor(user, "PASSWORD_RESET");
    await sendOtpEmail({ to: normalized, otp, expiresMinutes: OTP_EXPIRY_MINUTES });
  }
  return { message: FORGOT_RESPONSE_MESSAGE };
}

async function verifyResetOtp(email, otp, companyId = null) {
  const normalized = normalizeEmail(email);
  const user = await resolveRecoveryTarget(normalized, companyId);
  const row = user ? await passwordResetRepository.findLatestActiveOtp(user.id, "PASSWORD_RESET") : null;
  if (!row || !isOtpUsable(row)) {
    await hashPassword(otp);
    throw invalidOtpError();
  }
  const ok = await verifyPassword(row.otpHash, otp);
  if (!ok) {
    await passwordResetRepository.incrementOtpAttempts(row.id);
    throw invalidOtpError();
  }
  await passwordResetRepository.markOtpVerified(row.id);
  return { verified: true };
}

async function completePasswordReset(email, otp, newPassword, companyId = null) {
  const normalized = normalizeEmail(email);
  const user = await resolveRecoveryTarget(normalized, companyId);
  const row = user ? await passwordResetRepository.findLatestActiveOtp(user.id, "PASSWORD_RESET") : null;
  // The verify step must come first (verifiedAt) and the code is
  // checked again here, so possession is proven at completion time.
  if (!row || !isOtpUsable(row) || !row.verifiedAt) {
    await hashPassword(otp);
    throw invalidOtpError();
  }
  const ok = await verifyPassword(row.otpHash, otp);
  if (!ok) {
    await passwordResetRepository.incrementOtpAttempts(row.id);
    throw invalidOtpError();
  }
  // Valid code holders see normal account rules (same as login):
  // inactive and suspended accounts cannot rotate credentials.
  if (!user.isActive) {
    throw new AppError(403, "AUTH_ACCOUNT_INACTIVE", "Account is inactive");
  }
  assertCompanyActive(user);
  const snapshot = await resolveActorSnapshot(user.id);
  const audit = assertAuditInput({
    actorId: snapshot.id,
    actorRole: snapshot.role,
    actorEmail: snapshot.email,
    companyId: user.companyId ?? null,
    action: "UPDATED",
    resource: "USER",
    outcome: "SUCCESS",
    details: { via: "password-reset" },
  });
  await passwordResetRepository.rotatePasswordTx({
    userId: user.id,
    otpId: row.id,
    passwordHash: await hashPassword(newPassword),
    passwordChangedAt: new Date(),
    audit,
  });
  return { message: "Password has been reset successfully" };
}

async function requestPasswordChangeOtp(userId) {
  const user = await authRepository.findUserById(userId);
  if (!user) {
    throw new AppError(401, "AUTH_UNAUTHORIZED", "Authentication required");
  }
  if (!user.isActive) {
    throw new AppError(403, "AUTH_ACCOUNT_INACTIVE", "Account is inactive");
  }
  const otp = await issueOtpFor(user, "PASSWORD_CHANGE");
  await sendOtpEmail({ to: user.email, otp, expiresMinutes: OTP_EXPIRY_MINUTES });
  return { message: "A verification code has been sent to your email." };
}

async function changePassword(userId, otp, newPassword) {
  const user = await authRepository.findUserById(userId);
  if (!user) {
    throw new AppError(401, "AUTH_UNAUTHORIZED", "Authentication required");
  }
  if (!user.isActive) {
    throw new AppError(403, "AUTH_ACCOUNT_INACTIVE", "Account is inactive");
  }
  const row = await passwordResetRepository.findLatestActiveOtp(user.id, "PASSWORD_CHANGE");
  if (!row || !isOtpUsable(row)) {
    await hashPassword(otp);
    throw invalidOtpError();
  }
  const ok = await verifyPassword(row.otpHash, otp);
  if (!ok) {
    await passwordResetRepository.incrementOtpAttempts(row.id);
    throw invalidOtpError();
  }
  const snapshot = await resolveActorSnapshot(user.id);
  const audit = assertAuditInput({
    actorId: snapshot.id,
    actorRole: snapshot.role,
    actorEmail: snapshot.email,
    companyId: user.companyId ?? null,
    action: "UPDATED",
    resource: "USER",
    outcome: "SUCCESS",
    details: { via: "password-change" },
  });
  await passwordResetRepository.rotatePasswordTx({
    userId: user.id,
    otpId: row.id,
    passwordHash: await hashPassword(newPassword),
    passwordChangedAt: new Date(),
    audit,
  });
  // Fresh session for the caller: pre-rotation tokens are dead by the
  // watermark, so mint the post-rotation pair (same shape as login).
  const refreshed = await authRepository.findUserById(user.id);
  return issueTokenPair(refreshed);
}

module.exports = {
  register,
  login,
  loginWithGoogle,
  refresh,
  getMe,
  logout,
  requestPasswordReset,
  verifyResetOtp,
  completePasswordReset,
  requestPasswordChangeOtp,
  changePassword,
  // Pure identity-resolution helpers (no I/O) shared with unit tests,
  // following the decideCompanyContext precedent.
  STAFF_ROLES,
  isStaffUser,
  resolveLoginCandidates,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
};
