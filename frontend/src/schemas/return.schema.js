import { z } from 'zod';

/**
 * Client-side return-request schema mirroring the backend contract
 * (`returns.validation.js`): controlled reason enum, details ≤1000,
 * required (non-blank) when the reason is `OTHER`.
 */
export const returnReasonSchema = z.enum([
  'WRONG_COLOR',
  'WRONG_SIZE',
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'OTHER',
]);

export const returnSchema = z
  .object({
    reason: returnReasonSchema,
    details: z.string().trim().max(1000, 'Details must be at most 1000 characters.').optional().or(z.literal('')),
  })
  .superRefine((value, ctx) => {
    if (value.reason === 'OTHER' && !value.details?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['details'],
        message: 'Details are required when the reason is Other.',
      });
    }
  });
