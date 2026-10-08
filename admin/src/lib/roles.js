/**
 * Admin-panel role model (Phase 2C-22R). One common panel and one login
 * entry serve exactly these backend roles — no custom roles, no second
 * model (role strings come from the server-provided `user.roles[]`).
 * CUSTOMER is never a panel role. Unknown/roleless users are denied
 * everywhere by the absence of a match.
 *
 * Frontend gates are UX layering only: backend `authorize(...)` stays
 * authoritative per endpoint.
 */
export const ADMIN_PANEL_ROLES = Object.freeze(['SUPER_ADMIN', 'ADMIN', 'HEAD', 'MEMBER']);

export function hasAnyRole(user, roles) {
  if (!Array.isArray(user?.roles) || !Array.isArray(roles)) return false;
  return roles.some((role) => user.roles.includes(role));
}

export function isAdminPanelUser(user) {
  return hasAnyRole(user, ADMIN_PANEL_ROLES);
}

export function isMemberUser(user) {
  return Array.isArray(user?.roles) && user.roles.includes('MEMBER');
}
