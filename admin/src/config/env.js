/**
 * Validated access to Vite environment variables (admin app).
 * Own environment configuration — may point at the same backend API as the
 * storefront. No backend hosts are hardcoded in components or services.
 */

function readString(name, fallback = '') {
  const value = import.meta.env?.[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

export const env = {
  /** Must include `/api/v1`. */
  apiUrl: readString('VITE_API_URL', 'http://localhost:3000/api/v1'),
  /** Prefix for backend `storagePath` image references (no static serving
      route exists yet — previews fall back gracefully until it lands). */
  mediaBaseUrl: readString('VITE_MEDIA_BASE_URL', 'http://localhost:3000'),
  appName: readString('VITE_APP_NAME', 'Tech Pulse Admin'),
  isDev: Boolean(import.meta.env?.DEV),
  isProd: Boolean(import.meta.env?.PROD),
};

export function assertApiUrl() {
  if (!env.apiUrl) {
    throw new Error(
      'Missing VITE_API_URL. Set it to the backend base URL including `/api/v1`.',
    );
  }
  return env.apiUrl;
}
