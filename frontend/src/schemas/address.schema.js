import { z } from 'zod';

/**
 * Client-side address schema mirroring the backend contract
 * (API_INTEGRATION §4). `label`/`addressLine2` optional; everything else
 * required within backend max lengths. Unknown fields are stripped by the
 * service before submit (backend Zod rejects them with `422`).
 */
export const addressSchema = z.object({
  label: z.string().trim().max(50, 'Label is too long.').optional().or(z.literal('')),
  fullName: z.string().trim().min(1, 'Full name is required.').max(150, 'Full name is too long.'),
  phone: z.string().trim().min(1, 'Phone is required.').max(30, 'Phone number is too long.'),
  addressLine1: z.string().trim().min(1, 'Address line 1 is required.').max(255, 'Address is too long.'),
  addressLine2: z.string().trim().max(255, 'Address is too long.').optional().or(z.literal('')),
  city: z.string().trim().min(1, 'City is required.').max(100, 'City name is too long.'),
  state: z.string().trim().min(1, 'State is required.').max(100, 'State name is too long.'),
  postalCode: z.string().trim().min(1, 'Postal code is required.').max(20, 'Postal code is too long.'),
  country: z.string().trim().min(1, 'Country is required.').max(100, 'Country name is too long.'),
  isDefault: z.boolean().optional(),
});
