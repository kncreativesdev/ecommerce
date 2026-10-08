import { describe, expect, it } from 'vitest';
import { ADMIN_PANEL_ROLES, hasAnyRole, isAdminPanelUser } from '../roles.js';

/**
 * Phase 2C-22R: the single admin-panel role model. Exactly
 * SUPER_ADMIN/ADMIN/HEAD/MEMBER share the panel and login entry;
 * CUSTOMER, unknown, and roleless identities are denied everywhere.
 */
describe('admin panel roles', () => {
  it('admits exactly the four staff roles, in a fixed order', () => {
    expect([...ADMIN_PANEL_ROLES]).toEqual(['SUPER_ADMIN', 'ADMIN', 'HEAD', 'MEMBER']);
    expect(Object.isFrozen(ADMIN_PANEL_ROLES)).toBe(true);
  });

  it.each([['SUPER_ADMIN'], ['ADMIN'], ['HEAD'], ['MEMBER']])('admits %s', (role) => {
    expect(isAdminPanelUser({ id: 'u1', roles: [role] })).toBe(true);
    expect(isAdminPanelUser({ id: 'u1', roles: ['CUSTOMER', role] })).toBe(true);
  });

  it.each([['CUSTOMER'], ['OWNER'], [''], [undefined]])('rejects %s', (role) => {
    const roles = role === undefined ? undefined : [role];
    expect(isAdminPanelUser({ id: 'u1', roles })).toBe(false);
  });

  it('rejects missing users, missing roles, and non-array roles', () => {
    expect(isAdminPanelUser(null)).toBe(false);
    expect(isAdminPanelUser(undefined)).toBe(false);
    expect(isAdminPanelUser({ id: 'u1' })).toBe(false);
    expect(isAdminPanelUser({ id: 'u1', roles: 'ADMIN' })).toBe(false);
    expect(isAdminPanelUser({ id: 'u1', roles: [] })).toBe(false);
  });

  it('hasAnyRole matches any overlap and nothing else', () => {
    expect(hasAnyRole({ roles: ['HEAD'] }, ['ADMIN'])).toBe(false);
    expect(hasAnyRole({ roles: ['HEAD'] }, ['ADMIN', 'HEAD'])).toBe(true);
    expect(hasAnyRole(null, ['ADMIN'])).toBe(false);
    expect(hasAnyRole({ roles: ['ADMIN'] }, null)).toBe(false);
  });
});
