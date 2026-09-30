const crypto = require("crypto");

const { AppError } = require("../../utils/appError");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../../utils/jwt");
const { env } = require("../../config/env");
const authRepository = require("./auth.repository");
const { verifyGoogleIdToken } = require("./auth.google");
const {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  toSafeUser,
} = require("./auth.utils");

function issueTokenPair(user) {
  const safeUser = toSafeUser(user);
  return {
    user: safeUser,
    accessToken: signAccessToken(safeUser),
    refreshToken: signRefreshToken(safeUser.id),
  };
}

async function register(input) {
  const email = normalizeEmail(input.email);
  const existing = await authRepository.findUserByEmail(email);
  if (existing) {
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

async function login(input) {
  const email = normalizeEmail(input.email);
  const user = await authRepository.findUserByEmail(email);

  const passwordOk = user ? await verifyPassword(user.passwordHash, input.password) : false;
  if (!user || !passwordOk) {
    throw new AppError(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (!user.isActive) {
    throw new AppError(403, "AUTH_ACCOUNT_INACTIVE", "Account is inactive");
  }

  return issueTokenPair(user);
}

async function refresh(refreshToken) {
  if (typeof refreshToken !== "string" || refreshToken === "") {
    throw new AppError(401, "AUTH_REFRESH_TOKEN_INVALID", "Refresh token is missing or invalid");
  }

  const result = verifyRefreshToken(refreshToken);
  if (!result.ok || typeof result.payload.sub !== "string") {
    throw new AppError(401, "AUTH_REFRESH_TOKEN_INVALID", "Refresh token is missing or invalid");
  }

  const user = await authRepository.findUserById(result.payload.sub);
  if (!user || !user.isActive) {
    throw new AppError(401, "AUTH_REFRESH_TOKEN_INVALID", "Refresh token is missing or invalid");
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

async function logout() {
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
 */
async function loginWithGoogle(idToken) {
  const clientId = typeof env.googleClientId === "string" ? env.googleClientId.trim() : "";
  if (clientId === "") {
    throw new AppError(503, "AUTH_GOOGLE_NOT_CONFIGURED", "Google sign-in is not configured");
  }
  const claims = await verifyGoogleIdToken(idToken, clientId);
  const email = normalizeEmail(claims.email);

  let user = await authRepository.findUserByEmail(email);
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
        },
        "CUSTOMER"
      );
    } catch (err) {
      if (err.code === "P2002") {
        // Registration race: another request created the account first.
        user = await authRepository.findUserByEmail(email);
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

  return issueTokenPair(user);
}

module.exports = { register, login, loginWithGoogle, refresh, getMe, logout };
