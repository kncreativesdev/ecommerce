const { env } = require("../../config/env");
const authService = require("./auth.service");
const { registerSchema, loginSchema } = require("./auth.validation");
const { setRefreshCookie, clearRefreshCookie } = require("./auth.utils");

async function register(req, res, next) {
  try {
    const input = registerSchema.parse(req.body);
    const user = await authService.register(input);
    return res.status(201).json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
}

async function login(req, res, next) {
  try {
    const input = loginSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await authService.login(input);
    setRefreshCookie(res, refreshToken);
    return res.status(200).json({ success: true, data: { user, accessToken } });
  } catch (err) {
    return next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const refreshToken = req.cookies ? req.cookies[env.refreshCookieName] : undefined;
    const { accessToken, refreshToken: rotatedRefreshToken } =
      await authService.refresh(refreshToken);
    setRefreshCookie(res, rotatedRefreshToken);
    return res.status(200).json({ success: true, data: { accessToken } });
  } catch (err) {
    return next(err);
  }
}

async function logout(req, res, next) {
  try {
    const result = await authService.logout();
    clearRefreshCookie(res);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await authService.getMe(req.user.id);
    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, login, refresh, logout, me };
