import { describe, it, expect } from "vitest";

import {
  ROLES,
  ACTIONS,
  can,
  outranks,
  canManageRole,
  isKnownRole,
} from "../../src/config/permissions.js";

/**
 * TARGET SaaS permission-matrix policy tests (Phase 0).
 *
 * These tests pin the AGREED matrix from docs/MULTI_COMPANY_SAAS.md.
 * They cover the pure policy definition only: nothing here touches
 * routes, middleware, services, or the database, and none of them
 * changes existing authorization behavior.
 */

describe("permission matrix roles and actions", () => {
  it("defines exactly the five fixed roles", () => {
    expect(Object.values(ROLES).sort()).toEqual(
      ["ADMIN", "CUSTOMER", "HEAD", "MEMBER", "SUPER_ADMIN"].sort()
    );
  });

  it("exposes only explicit actions (no per-user custom permissions)", () => {
    expect(Object.values(ACTIONS).sort()).toEqual(
      [
        "CREATE",
        "READ",
        "UPDATE",
        "DEACTIVATE",
        "DELETE",
        "MANAGE",
        "VIEW_OWN",
        "VIEW_DESCENDANTS",
        "PLATFORM_MANAGE",
      ].sort()
    );
  });

  it("rejects unknown roles, resources, and actions", () => {
    expect(isKnownRole("OWNER")).toBe(false);
    expect(can("OWNER", "product", "READ")).toBe(false);
    expect(can(ROLES.ADMIN, "product", "FLY")).toBe(false);
    expect(can(ROLES.ADMIN, "spaceship", "READ")).toBe(false);
  });
});

describe("SUPER_ADMIN platform boundary", () => {
  it("has platform company-management permission", () => {
    expect(can(ROLES.SUPER_ADMIN, "company", "PLATFORM_MANAGE")).toBe(true);
    expect(can(ROLES.SUPER_ADMIN, "company_settings", "PLATFORM_MANAGE")).toBe(true);
  });

  it("can read aggregate statistics and audit logs", () => {
    expect(can(ROLES.SUPER_ADMIN, "company_statistics", "READ")).toBe(true);
    expect(can(ROLES.SUPER_ADMIN, "audit_log", "READ")).toBe(true);
  });

  it("does not receive company ecommerce operational permissions", () => {
    expect(can(ROLES.SUPER_ADMIN, "product", "READ")).toBe(false);
    expect(can(ROLES.SUPER_ADMIN, "product", "MANAGE")).toBe(false);
    expect(can(ROLES.SUPER_ADMIN, "order", "MANAGE")).toBe(false);
    expect(can(ROLES.SUPER_ADMIN, "order", "READ")).toBe(false);
    expect(can(ROLES.SUPER_ADMIN, "inventory", "READ")).toBe(false);
    expect(can(ROLES.SUPER_ADMIN, "customer_account", "MANAGE")).toBe(false);
    expect(can(ROLES.SUPER_ADMIN, "review", "MANAGE")).toBe(false);
    expect(can(ROLES.SUPER_ADMIN, "coupon", "READ")).toBe(false);
    expect(can(ROLES.SUPER_ADMIN, "notification", "MANAGE")).toBe(false);
  });
});

describe("ADMIN company control", () => {
  it("can manage company resources", () => {
    expect(can(ROLES.ADMIN, "product", "CREATE")).toBe(true);
    expect(can(ROLES.ADMIN, "product", "DELETE")).toBe(true);
    expect(can(ROLES.ADMIN, "category", "DELETE")).toBe(true);
    expect(can(ROLES.ADMIN, "inventory", "UPDATE")).toBe(true);
    expect(can(ROLES.ADMIN, "coupon", "DELETE")).toBe(true);
    expect(can(ROLES.ADMIN, "order", "MANAGE")).toBe(true);
    expect(can(ROLES.ADMIN, "customer_account", "MANAGE")).toBe(true);
    expect(can(ROLES.ADMIN, "review", "MANAGE")).toBe(true);
  });

  it("can manage HEADs and MEMBERs across the full lifecycle", () => {
    for (const action of ["CREATE", "READ", "UPDATE", "DEACTIVATE", "DELETE"]) {
      expect(can(ROLES.ADMIN, "head", action)).toBe(true);
      expect(can(ROLES.ADMIN, "member", action)).toBe(true);
    }
    expect(canManageRole(ROLES.ADMIN, ROLES.HEAD)).toBe(true);
    expect(canManageRole(ROLES.ADMIN, ROLES.MEMBER)).toBe(true);
  });

  it("cannot platform-manage companies", () => {
    expect(can(ROLES.ADMIN, "company", "PLATFORM_MANAGE")).toBe(false);
  });
});

describe("HEAD permissions", () => {
  it("can manage MEMBERs but not HEADs", () => {
    expect(can(ROLES.HEAD, "member", "CREATE")).toBe(true);
    expect(can(ROLES.HEAD, "member", "UPDATE")).toBe(true);
    expect(can(ROLES.HEAD, "member", "DEACTIVATE")).toBe(true);
    expect(canManageRole(ROLES.HEAD, ROLES.MEMBER)).toBe(true);
    expect(canManageRole(ROLES.HEAD, ROLES.HEAD)).toBe(false);
    expect(can(ROLES.HEAD, "head", "CREATE")).toBe(false);
    expect(can(ROLES.HEAD, "head", "UPDATE")).toBe(false);
    expect(can(ROLES.HEAD, "head", "DELETE")).toBe(false);
  });

  it("cannot delete MEMBERs or company data", () => {
    expect(can(ROLES.HEAD, "member", "DELETE")).toBe(false);
    expect(can(ROLES.HEAD, "product", "DELETE")).toBe(false);
    expect(can(ROLES.HEAD, "category", "DELETE")).toBe(false);
    expect(can(ROLES.HEAD, "coupon", "DELETE")).toBe(false);
  });

  it("can add/update/deactivate operational data and process orders", () => {
    expect(can(ROLES.HEAD, "product", "CREATE")).toBe(true);
    expect(can(ROLES.HEAD, "product", "DEACTIVATE")).toBe(true);
    expect(can(ROLES.HEAD, "category", "DEACTIVATE")).toBe(true);
    expect(can(ROLES.HEAD, "inventory", "DEACTIVATE")).toBe(true);
    expect(can(ROLES.HEAD, "coupon", "DEACTIVATE")).toBe(true);
    expect(can(ROLES.HEAD, "order", "MANAGE")).toBe(true);
  });
});

describe("MEMBER restrictions", () => {
  it("cannot delete anything", () => {
    expect(can(ROLES.MEMBER, "product", "DELETE")).toBe(false);
    expect(can(ROLES.MEMBER, "category", "DELETE")).toBe(false);
    expect(can(ROLES.MEMBER, "coupon", "DELETE")).toBe(false);
    expect(can(ROLES.MEMBER, "member", "DELETE")).toBe(false);
    expect(can(ROLES.MEMBER, "review", "DELETE")).toBe(false);
  });

  it("cannot deactivate anything", () => {
    expect(can(ROLES.MEMBER, "product", "DEACTIVATE")).toBe(false);
    expect(can(ROLES.MEMBER, "category", "DEACTIVATE")).toBe(false);
    expect(can(ROLES.MEMBER, "inventory", "DEACTIVATE")).toBe(false);
    expect(can(ROLES.MEMBER, "coupon", "DEACTIVATE")).toBe(false);
    expect(can(ROLES.MEMBER, "member", "DEACTIVATE")).toBe(false);
  });

  it("cannot manage users or notifications", () => {
    expect(canManageRole(ROLES.MEMBER, ROLES.MEMBER)).toBe(false);
    expect(canManageRole(ROLES.MEMBER, ROLES.HEAD)).toBe(false);
    expect(can(ROLES.MEMBER, "member", "CREATE")).toBe(false);
    expect(can(ROLES.MEMBER, "head", "READ")).toBe(false);
    expect(can(ROLES.MEMBER, "notification", "MANAGE")).toBe(false);
  });

  it("can work on permitted operational resources and own logs only", () => {
    expect(can(ROLES.MEMBER, "product", "CREATE")).toBe(true);
    expect(can(ROLES.MEMBER, "product", "UPDATE")).toBe(true);
    expect(can(ROLES.MEMBER, "category", "UPDATE")).toBe(true);
    expect(can(ROLES.MEMBER, "order", "MANAGE")).toBe(true);
    expect(can(ROLES.MEMBER, "inventory", "UPDATE")).toBe(true);
    expect(can(ROLES.MEMBER, "audit_log", "VIEW_OWN")).toBe(true);
    expect(can(ROLES.MEMBER, "audit_log", "VIEW_DESCENDANTS")).toBe(false);
  });
});

describe("CUSTOMER boundary", () => {
  it("cannot access admin operations", () => {
    expect(can(ROLES.CUSTOMER, "product", "CREATE")).toBe(false);
    expect(can(ROLES.CUSTOMER, "order", "MANAGE")).toBe(false);
    expect(can(ROLES.CUSTOMER, "coupon", "CREATE")).toBe(false);
    expect(can(ROLES.CUSTOMER, "member", "READ")).toBe(false);
    expect(can(ROLES.CUSTOMER, "company", "PLATFORM_MANAGE")).toBe(false);
    expect(can(ROLES.CUSTOMER, "audit_log", "READ")).toBe(false);
  });
});

describe("hierarchy", () => {
  it("orders SUPER_ADMIN above ADMIN above HEAD above MEMBER", () => {
    expect(outranks(ROLES.SUPER_ADMIN, ROLES.ADMIN)).toBe(true);
    expect(outranks(ROLES.ADMIN, ROLES.HEAD)).toBe(true);
    expect(outranks(ROLES.HEAD, ROLES.MEMBER)).toBe(true);
    expect(outranks(ROLES.MEMBER, ROLES.HEAD)).toBe(false);
    expect(outranks(ROLES.ADMIN, ROLES.ADMIN)).toBe(false);
  });

  it("keeps CUSTOMER outside the employee hierarchy", () => {
    expect(outranks(ROLES.CUSTOMER, ROLES.MEMBER)).toBe(false);
    expect(outranks(ROLES.ADMIN, ROLES.CUSTOMER)).toBe(false);
    expect(canManageRole(ROLES.ADMIN, ROLES.CUSTOMER)).toBe(false);
  });
});
