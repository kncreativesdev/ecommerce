import { apiGet } from '../lib/apiClient.js';

/**
 * Public storefront announcement (verified `announcements.controller`):
 * - `GET /announcements/current` (PUBLIC, no auth) →
 *   `{ announcement: { message, linkLabel, linkTarget } | null }`.
 * `null` means no active announcement — the bar hides (never a hardcoded
 * fallback message in production render).
 */
export function fetchCurrentAnnouncement() {
  return apiGet('/announcements/current').then((data) => data?.announcement ?? null);
}
