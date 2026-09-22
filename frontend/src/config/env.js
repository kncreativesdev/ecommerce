/**
 * Validated access to Vite environment variables.
 *
 * VITE_API_URL is required and fail-fast per FRONTEND_ARCHITECTURE.md §9:
 * a missing or invalid base throws during module initialization instead of
 * silently falling back. No localhost fallback is retained for the API base
 * so a misconfigured environment cannot defeat the documented contract.
 */

function readString(name, fallback = '') {
  const value = import.meta.env?.[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, '');
}

function validateApiUrl(raw) {
  if (!raw) {
    throw new Error(
      'Missing VITE_API_URL. Set it to the backend base URL including `/api/v1`.',
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      'Invalid VITE_API_URL. Set it to an absolute backend base URL ending in `/api/v1`.',
    );
  }
  const pathname = stripTrailingSlashes(url.pathname);
  if (!pathname.endsWith('/api/v1')) {
    throw new Error(
      'Invalid VITE_API_URL. The base path must end in `/api/v1`.',
    );
  }
  return stripTrailingSlashes(raw);
}

// Fail fast at startup: validation runs during module initialization.
const apiUrl = validateApiUrl(readString('VITE_API_URL', ''));

export const env = {
  /** Backend base URL ending in `/api/v1` (e.g. http://localhost:3001/api/v1). */
  apiUrl,
  /** Prefix for backend `storagePath` image references (see FRONTEND_SPEC §16). */
  mediaBaseUrl: readString('VITE_MEDIA_BASE_URL', 'http://localhost:3000'),
  appName: readString('VITE_APP_NAME', 'Tech Pulse'),
  /** Placeholder until the company provides the real number. */
  whatsappLink: readString('VITE_WHATSAPP_LINK', ''),
  /** Empty until the Maps embed is configured (Support page shows a fallback). */
  googleMapsEmbedUrl: readString('VITE_GOOGLE_MAPS_EMBED_URL', ''),
  /** Placeholder until real company information is provided. */
  supportEmail: readString('VITE_SUPPORT_EMAIL', 'support@example.com'),
  isDev: Boolean(import.meta.env?.DEV),
  isProd: Boolean(import.meta.env?.PROD),
};

export function assertApiUrl() {
  // env.apiUrl was already validated at module initialization; re-validate
  // here so direct callers also enforce the documented contract.
  return validateApiUrl(env.apiUrl);
}
