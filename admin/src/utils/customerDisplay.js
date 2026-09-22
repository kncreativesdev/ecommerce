/**
 * Customer display derivations over the safe admin user shape
 * (`id, email, firstName, lastName, phone, isActive, roles[],
 * createdAt, updatedAt`). Display-only — never auth or totals math.
 */

/** Full name with email fallback (never an empty cell). */
export function customerDisplayName(customer) {
  const full = [customer?.firstName, customer?.lastName]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .trim();
  if (full) return full;
  return customer?.email ?? '—';
}

/** Role names as a stable comma string (`CUSTOMER`, `ADMIN`, …). */
export function customerRoleLabel(customer) {
  if (!Array.isArray(customer?.roles) || customer.roles.length === 0) return '—';
  return customer.roles.join(', ');
}
