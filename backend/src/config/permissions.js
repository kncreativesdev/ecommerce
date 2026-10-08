/**
 * TARGET SaaS permission matrix — Phase 0 policy definition only.
 *
 * Source of truth reference: docs/MULTI_COMPANY_SAAS.md (sections B–H, J).
 *
 * This module DEFINES the agreed target permissions for
 * SUPER_ADMIN / ADMIN / HEAD / MEMBER / CUSTOMER. It is intentionally
 * NOT wired into any route, controller, service, or middleware in
 * Phase 0: existing authorization behavior (authorize("ADMIN") and
 * owner-scoped checks) is completely unchanged.
 *
 * Design rules:
 * - Pure, side-effect-free functions over plain data (no Prisma, no
 *   req/res, no database). Safe to unit test without MySQL.
 * - Fixed roles only. No custom roles, no per-user permission matrices.
 * - Explicit actions only (see ACTIONS). No arbitrary strings.
 * - Frontend visibility is never the boundary; this matrix documents
 *   what the backend MUST enforce when later phases wire it in.
 */

const ROLES = Object.freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  HEAD: "HEAD",
  MEMBER: "MEMBER",
  CUSTOMER: "CUSTOMER",
});

const ACTIONS = Object.freeze({
  CREATE: "CREATE",
  READ: "READ",
  UPDATE: "UPDATE",
  DEACTIVATE: "DEACTIVATE",
  DELETE: "DELETE",
  MANAGE: "MANAGE",
  VIEW_OWN: "VIEW_OWN",
  VIEW_DESCENDANTS: "VIEW_DESCENDANTS",
  PLATFORM_MANAGE: "PLATFORM_MANAGE",
});

const RESOURCES = Object.freeze({
  COMPANY: "company",
  COMPANY_SETTINGS: "company_settings",
  COMPANY_STATISTICS: "company_statistics",
  USER: "user",
  HEAD: "head",
  MEMBER: "member",
  CUSTOMER_ACCOUNT: "customer_account",
  PRODUCT: "product",
  CATEGORY: "category",
  INVENTORY: "inventory",
  COUPON: "coupon",
  ORDER: "order",
  NOTIFICATION: "notification",
  ANNOUNCEMENT: "announcement",
  REVIEW: "review",
  AUDIT_LOG: "audit_log",
});

// Employee hierarchy, highest first. CUSTOMER is company-scoped but
// outside the employee hierarchy, so it never appears here.
const HIERARCHY = Object.freeze([
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.HEAD,
  ROLES.MEMBER,
]);

/**
 * TARGET permission grants: `${resource}:${action}` per role.
 * A missing entry means DENIED.
 *
 * Read against docs/MULTI_COMPANY_SAAS.md:
 * - SUPER_ADMIN: platform company lifecycle + config + ADMIN
 *   credentials + aggregate stats + audit (own + per-company). Never
 *   company ecommerce operations (no product/order/inventory/customer/
 *   review/coupon/cart/wishlist grants of any kind).
 * - ADMIN: full control of own company, including HEAD/MEMBER
 *   lifecycle (create/update/deactivate/delete), ecommerce operations
 *   per existing resource lifecycle rules, customer ban, review
 *   management, own + HEAD + MEMBER logs, company settings/statistics.
 * - HEAD: MEMBER lifecycle except delete; add/update/deactivate (never
 *   delete) for inventory/categories/coupons/products; order
 *   manage/process; own + MEMBER logs. Never HEAD management, never
 *   ADMIN, never cross-company.
 * - MEMBER: create/update (never delete, never deactivate) for
 *   categories/products; permitted order/inventory operations; own logs
 *   only. Never user management, never notifications management, never
 *   peer account access.
 * - CUSTOMER: own company-scoped resources only (cart/wishlist/
 *   addresses/own orders/own reviews/own notifications/coupon
 *   validation). No admin operations of any kind.
 */
const GRANTS = Object.freeze({
  [ROLES.SUPER_ADMIN]: Object.freeze([
    "company:PLATFORM_MANAGE",
    "company_settings:PLATFORM_MANAGE",
    "company_statistics:READ",
    "user:PLATFORM_MANAGE",
    "audit_log:READ",
    "audit_log:VIEW_DESCENDANTS",
  ]),
  [ROLES.ADMIN]: Object.freeze([
    "company_settings:MANAGE",
    "company_statistics:READ",
    "user:MANAGE",
    "head:CREATE",
    "head:READ",
    "head:UPDATE",
    "head:DEACTIVATE",
    "head:DELETE",
    "member:CREATE",
    "member:READ",
    "member:UPDATE",
    "member:DEACTIVATE",
    "member:DELETE",
    "customer_account:MANAGE",
    "product:CREATE",
    "product:READ",
    "product:UPDATE",
    "product:DEACTIVATE",
    "product:DELETE",
    "category:CREATE",
    "category:READ",
    "category:UPDATE",
    "category:DEACTIVATE",
    "category:DELETE",
    "inventory:CREATE",
    "inventory:READ",
    "inventory:UPDATE",
    "inventory:DEACTIVATE",
    "coupon:CREATE",
    "coupon:READ",
    "coupon:UPDATE",
    "coupon:DEACTIVATE",
    "coupon:DELETE",
    "order:MANAGE",
    "notification:MANAGE",
    "announcement:MANAGE",
    "review:MANAGE",
    "audit_log:VIEW_OWN",
    "audit_log:VIEW_DESCENDANTS",
  ]),
  [ROLES.HEAD]: Object.freeze([
    "member:CREATE",
    "member:READ",
    "member:UPDATE",
    "member:DEACTIVATE",
    "product:CREATE",
    "product:READ",
    "product:UPDATE",
    "product:DEACTIVATE",
    "category:CREATE",
    "category:READ",
    "category:UPDATE",
    "category:DEACTIVATE",
    "inventory:CREATE",
    "inventory:READ",
    "inventory:UPDATE",
    "inventory:DEACTIVATE",
    "coupon:CREATE",
    "coupon:READ",
    "coupon:UPDATE",
    "coupon:DEACTIVATE",
    "order:MANAGE",
    "audit_log:VIEW_OWN",
    "audit_log:VIEW_DESCENDANTS",
  ]),
  [ROLES.MEMBER]: Object.freeze([
    "product:CREATE",
    "product:READ",
    "product:UPDATE",
    "category:CREATE",
    "category:READ",
    "category:UPDATE",
    "inventory:CREATE",
    "inventory:READ",
    "inventory:UPDATE",
    "coupon:READ",
    "order:MANAGE",
    "audit_log:VIEW_OWN",
  ]),
  [ROLES.CUSTOMER]: Object.freeze([
    "product:READ",
    "category:READ",
    "coupon:READ",
    "order:CREATE",
    "order:READ",
    "notification:VIEW_OWN",
    "review:CREATE",
    "review:READ",
    "review:UPDATE",
    "review:DELETE",
  ]),
});

function isKnownRole(role) {
  return role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN || role === ROLES.HEAD || role === ROLES.MEMBER || role === ROLES.CUSTOMER;
}

/**
 * Returns true when `role` is granted `action` on `resource` in the
 * TARGET matrix. Unknown roles/resources/actions are always denied.
 */
function can(role, resource, action) {
  if (!isKnownRole(role) || typeof resource !== "string" || typeof action !== "string") {
    return false;
  }
  const grants = GRANTS[role];
  if (!Array.isArray(grants)) {
    return false;
  }
  return grants.includes(`${resource}:${action}`);
}

/**
 * Hierarchy rank: lower index outranks. CUSTOMER is outside the
 * employee hierarchy and returns -1 (never above or below anyone).
 */
function hierarchyRank(role) {
  const index = HIERARCHY.indexOf(role);
  return index === -1 ? -1 : index;
}

/**
 * True when `actorRole` strictly outranks `targetRole` within the
 * employee hierarchy (SUPER_ADMIN > ADMIN > HEAD > MEMBER).
 * CUSTOMER is never in the hierarchy: always false when either side
 * is CUSTOMER or unknown.
 */
function outranks(actorRole, targetRole) {
  const actorRank = hierarchyRank(actorRole);
  const targetRank = hierarchyRank(targetRole);
  if (actorRank === -1 || targetRank === -1) {
    return false;
  }
  return actorRank < targetRank;
}

/**
 * TARGET user-management rule: an actor may manage accounts of roles
 * strictly below them, except where the matrix narrows it further:
 * HEAD manages MEMBERs only (never HEADs, never ADMIN); MEMBER manages
 * nobody; CUSTOMER manages nobody; SUPER_ADMIN manages at platform
 * level (company ADMIN credentials), not company user accounts.
 */
function canManageRole(actorRole, targetRole) {
  if (actorRole === ROLES.ADMIN && (targetRole === ROLES.HEAD || targetRole === ROLES.MEMBER)) {
    return true;
  }
  if (actorRole === ROLES.HEAD && targetRole === ROLES.MEMBER) {
    return true;
  }
  return false;
}

module.exports = {
  ROLES,
  ACTIONS,
  RESOURCES,
  HIERARCHY,
  GRANTS,
  isKnownRole,
  can,
  hierarchyRank,
  outranks,
  canManageRole,
};
