const { env } = require("../../config/env");
const authService = require("./auth.service");
const {
  registerSchema,
  loginSchema,
  googleSignInSchema,
  forgotPasswordSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
  changePasswordSchema,
} = require("./auth.validation");
const { setRefreshCookie, clearRefreshCookie } = require("./auth.utils");

/**
 * Server-resolved domain company for self-registration (Phase 2C-11).
 * The public resolver middleware guarantees the value or leaves it
 * null (unregistered hosts preserve legacy behavior); the register
 * schema strips body companyId, so callers can never select a tenant.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function register(req, res, next) {
  try {
    const input = registerSchema.parse(req.body);
    const user = await authService.register(input, companyIdOf(req));
    return res.status(201).json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
}

async function login(req, res, next) {
  try {
    const input = loginSchema.parse(req.body);
    // Phase 2C-26: the domain-resolved company scopes customer
    // identity (null on unregistered hosts — legacy behavior).
    // Never a client-supplied companyId (companyIdOf reads only the
    // server-attached context).
    const { user, accessToken, refreshToken } = await authService.login(input, companyIdOf(req));
    setRefreshCookie(res, refreshToken);
    return res.status(200).json({ success: true, data: { user, accessToken } });
  } catch (err) {
    return next(err);
  }
}

async function googleSignIn(req, res, next) {
  try {
    const input = googleSignInSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await authService.loginWithGoogle(input.idToken, companyIdOf(req));
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
    const refreshToken = req.cookies ? req.cookies[env.refreshCookieName] : undefined;
    const result = await authService.logout(refreshToken);
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

async function forgotPassword(req, res, next) {
  try {
    const input = forgotPasswordSchema.parse(req.body);
    const result = await authService.requestPasswordReset(input.email, companyIdOf(req));
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

async function verifyResetOtp(req, res, next) {
  try {
    const input = verifyResetOtpSchema.parse(req.body);
    const result = await authService.verifyResetOtp(input.email, input.otp, companyIdOf(req));
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const input = resetPasswordSchema.parse(req.body);
    const result = await authService.completePasswordReset(input.email, input.otp, input.newPassword, companyIdOf(req));
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

async function requestChangeOtp(req, res, next) {
  try {
    const result = await authService.requestPasswordChangeOtp(req.user.id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    // Identity comes from the session (req.user.id) — the strict
    // schema carries no userId, so callers cannot retarget anyone.
    const input = changePasswordSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await authService.changePassword(
      req.user.id,
      input.otp,
      input.newPassword
    );
    setRefreshCookie(res, refreshToken);
    return res.status(200).json({ success: true, data: { user, accessToken } });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  register,
  login,
  googleSignIn,
  refresh,
  logout,
  me,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  requestChangeOtp,
  changePassword,
};
