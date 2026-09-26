const { z } = require("zod");

const emailSchema = z.string().trim().toLowerCase().email().max(255);

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().min(1).max(30).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

module.exports = { registerSchema, loginSchema };
