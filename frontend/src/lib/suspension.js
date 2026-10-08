/**
 * Company-suspension presentation copy (Phase F1).
 *
 * The backend answers suspended-company operations with `403
 * COMPANY_SUSPENDED` (neutral message, no identifiers). These strings
 * are the single customer-facing wording for that state — plain
 * language, no backend codes, no company internals. Import-only;
 * no storage, no requests, no company identity.
 */
export const COMPANY_SUSPENDED_CODE = 'COMPANY_SUSPENDED';

export const SUSPENSION_TITLE = 'Storefront unavailable';

export const SUSPENSION_MESSAGE =
  'The company associated with this storefront is currently suspended. Please try again later or contact the company administrator.';

export const SUSPENSION_SIGNIN_MESSAGE =
  'This storefront is currently unavailable — the company is suspended, so signing in again will not restore access. Please try again later or contact the company administrator.';
