import { apiGet } from '../lib/apiClient.js';

/**
 * Customer marketing broadcast API access (verified `marketing.controller`):
 * - `GET /marketing/notifications/active` (auth — the bell is auth-only) →
 *   `{ notifications[]: { id, title, message, type, linkType, linkValue,
 *   startsAt, expiresAt, createdAt } }`.
 *
 * Destination mapping: `SHOP` → `/shop`, `CATEGORY` →
 * `/category/{linkValue}`, `PRODUCT` → `/product/{linkValue}`, `COUPON` →
 * `/shop`. Null/unknown link = no navigation (rendered as plain rows).
 */
export function fetchActiveMarketing() {
  return apiGet('/marketing/notifications/active').then((data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.notifications)) return data.notifications;
    return [];
  });
}

/** Internal route for a marketing item, or `null` when it must not navigate. */
export function resolveMarketingHref(item) {
  if (!item) return null;
  const { linkType, linkValue } = item;
  switch (linkType) {
    case 'SHOP':
      return '/shop';
    case 'CATEGORY':
      return linkValue ? `/category/${linkValue}` : null;
    case 'PRODUCT':
      return linkValue ? `/product/${linkValue}` : null;
    case 'COUPON':
      return '/shop';
    default:
      return null;
  }
}
