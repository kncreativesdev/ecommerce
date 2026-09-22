import { z } from 'zod';

/**
 * Client-side auth schemas mirroring backend limits (API_INTEGRATION §2).
 * Email is normalized (trim + lowercase) before submit; strict bodies are
 * built by the service so unknown fields never reach the backend.
 */

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .max(255, 'Email is too long.')
  .email('Enter a valid email address.')
  .transform((value) => value.toLowerCase());

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
});

export const registerSchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      .max(128, 'Password must be at most 128 characters.'),
    firstName: z.string().trim().max(100, 'First name is too long.').optional().or(z.literal('')),
    lastName: z.string().trim().max(100, 'Last name is too long.').optional().or(z.literal('')),
    phone: z.string().trim().max(30, 'Phone number is too long.').optional().or(z.literal('')),
  });
