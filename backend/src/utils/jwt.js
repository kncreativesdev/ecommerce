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

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
