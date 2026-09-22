import { z } from 'zod';

/**
 * Client-side review schema mirroring the backend contract
 * (API_INTEGRATION §12, verified `reviews.validation.js`):
 * rating integer 1–5 required; title ≤255; comment ≤5000; text fields
 * optional/nullable. Creation sends `orderItemId` only — `productId` is
 * derived server-side and must never be sent.
 */
export const reviewSchema = z.object({
  rating: z
    .number({ invalid_type_error: 'Rating is required.' })
    .int('Rating must be a whole number.')
    .min(1, 'Rating must be at least 1.')
    .max(5, 'Rating must be at most 5.'),
  title: z
    .string()
    .trim()
    .max(255, 'Title must be at most 255 characters.')
    .optional()
    .or(z.literal(''))
    .nullable(),
  comment: z
    .string()
    .trim()
    .max(5000, 'Comment must be at most 5000 characters.')
    .optional()
    .or(z.literal(''))
    .nullable(),
});
