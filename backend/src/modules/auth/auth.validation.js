const { z } = require("zod");

const emailSchema = z.string().trim().toLowerCase().email().max(255);

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  lastName: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().min(1).max(30).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

const googleSignInSchema = z
  .object({
    idToken: z.string().trim().min(1).max(5000),
  })
  .strict();

const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

const otpCodeSchema = z.string().trim().regex(/^\d{6}$/, "Invalid verification code");

const verifyResetOtpSchema = z
  .object({
    email: emailSchema,
    otp: otpCodeSchema,
  })
  .strict();

const resetPasswordSchema = z
  .object({
    email: emailSchema,
    otp: otpCodeSchema,
    newPassword: z.string().min(8).max(128),
  })
  .strict();

const changePasswordSchema = z
  .object({
    otp: otpCodeSchema,
    newPassword: z.string().min(8).max(128),
  })
  .strict();

module.exports = {
  registerSchema,
  loginSchema,
  googleSignInSchema,
  forgotPasswordSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
  changePasswordSchema,
};
