const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const { env } = require("../config/env");

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, roles: user.roles }, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn,
  });
}

function signRefreshToken(userId) {
  return jwt.sign({ sub: userId, jti: crypto.randomUUID() }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  });
}

function verifyWithSecret(token, secret) {
  try {
    return { ok: true, payload: jwt.verify(token, secret) };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "invalid" };
  }
}

function verifyAccessToken(token) {
  return verifyWithSecret(token, env.jwtAccessSecret);
}

function verifyRefreshToken(token) {
  return verifyWithSecret(token, env.jwtRefreshSecret);
}

/**
 * Reads the session metadata of a freshly minted refresh token without
 * verifying (callers sign it themselves in the same flow). Returns
 * null when the token carries no usable `jti`/`exp`.
 */
function refreshSessionMeta(token) {
  const payload = jwt.decode(token);
  if (!payload || typeof payload.jti !== "string" || typeof payload.exp !== "number") {
    return null;
  }
  return { jti: payload.jti, expiresAt: new Date(payload.exp * 1000) };
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, refreshSessionMeta };
