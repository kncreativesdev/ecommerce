const { AppError } = require("../../utils/appError");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../../utils/jwt");
const authRepository = require("./auth.repository");
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

module.exports = { register, login, refresh, getMe, logout };
