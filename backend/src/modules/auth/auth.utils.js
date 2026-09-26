const argon2 = require("argon2");

const { env } = require("../../config/env");
const { getRefreshCookieOptions, getClearRefreshCookieOptions } = require("../../config/cookies");

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

async function hashPassword(password) {
  return argon2.hash(password, ARGON2_OPTIONS);
}

async function verifyPassword(passwordHash, password) {
  try {
    return await argon2.verify(passwordHash, password);
  } catch (err) {
    return false;
  }
}

function setRefreshCookie(res, refreshToken) {
  res.cookie(env.refreshCookieName, refreshToken, getRefreshCookieOptions());
}

function clearRefreshCookie(res) {
  res.clearCookie(env.refreshCookieName, getClearRefreshCookieOptions());
}

function toSafeUser(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    phone: user.phone ?? null,
    roles: (user.roles || [])
      .filter((link) => link && link.role)
      .map((link) => link.role.name),
    createdAt: user.createdAt,
  };
}

module.exports = {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  setRefreshCookie,
  clearRefreshCookie,
  toSafeUser,
};
