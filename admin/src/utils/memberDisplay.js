/**
 * Team-member display + target-safety derivations over the safe admin
 * user shape (`id, email, firstName, lastName, phone, isActive,
 * roles[], createdAt, updatedAt`). Display-only — never auth decisions;
 * the backend (`users.service` Phase 2C-31 guards) stays authoritative
 * and answers every out-of-remit target with neutral 404s.
 *
 * Customer separation: only rows whose roles are all staff roles
 * (`ADMIN`/`HEAD`/`MEMBER`) render as team members. CUSTOMER-only,
 * SUPER_ADMIN, roleless, and mixed CUSTOMER rows never render — even
 * though ADMIN list responses may contain them (HEAD responses cannot:
 * the backend forces MEMBER-only scope).
 */

/** Manageable staff roles (never CUSTOMER, SUPER_ADMIN, or roleless). */
const STAFF_ROLES = ['ADMIN', 'HEAD', 'MEMBER'];

/** Full name with email fallback (never an empty cell). */
export function memberDisplayName(member) {
  const full = [member?.firstName, member?.lastName]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .trim();
  if (full) return full;
  return member?.email ?? '—';
}

/** True when the row may render on the Team Members page. */
export function isStaffRow(member) {
  const roles = Array.isArray(member?.roles) ? member.roles : [];
  return roles.length > 0 && roles.every((role) => STAFF_ROLES.includes(role));
}

/** True for exactly-`MEMBER` rows (the only editable/lifecycle target). */
export function isMemberOnlyRow(member) {
  return Array.isArray(member?.roles) && member.roles.length === 1 && member.roles[0] === 'MEMBER';
}

/** True for `HEAD`-role rows (ADMIN-viewer lifecycle targets only). */
export function isHeadRow(member) {
  return Array.isArray(member?.roles) && member.roles.includes('HEAD');
}
