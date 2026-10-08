import { describe, it, expect } from "vitest";

import { STAFF_ROLES, isStaffUser, resolveLoginCandidates } from "../../src/modules/auth/auth.service.js";
import { signAccessToken, signRefreshToken } from "../../src/utils/jwt.js";

/**
 * Phase 2C-26 identity-resolution unit tests (no database).
 *
 * `isStaffUser` / `resolveLoginCandidates` are pure, so the
 * deterministic disambiguation rules are pinned here with plain row
 * fixtures. Live-database authentication across companies is covered
 * by tests/integration/customer-identity.test.js.
 */

function row(overrides = {}) {
  return {
    id: "u-1",
    companyId: "c-a",
    roles: [{ role: { name: "CUSTOMER" } }],
    ...overrides,
  };
}

function rolesOf(...names) {
  return names.map((name) => ({ role: { name } }));
}

describe("STAFF_ROLES vocabulary", () => {
  it("covers exactly the platform/company staff roles (never CUSTOMER)", () => {
    expect([...STAFF_ROLES].sort()).toEqual(["ADMIN", "HEAD", "MEMBER", "SUPER_ADMIN"]);
  });
});

describe("isStaffUser", () => {
  it.each([["SUPER_ADMIN"], ["ADMIN"], ["HEAD"], ["MEMBER"]])("treats %s as staff", (name) => {
    expect(isStaffUser(row({ roles: rolesOf(name) }))).toBe(true);
  });

  it("treats CUSTOMER as non-staff", () => {
    expect(isStaffUser(row({ roles: rolesOf("CUSTOMER") }))).toBe(false);
  });

  it("treats multi-role rows holding any staff role as staff", () => {
    expect(isStaffUser(row({ roles: rolesOf("CUSTOMER", "ADMIN") }))).toBe(true);
  });

  it("treats roleless and unknown-role rows as non-staff", () => {
    expect(isStaffUser(row({ roles: [] }))).toBe(false);
    expect(isStaffUser(row({ roles: [{ role: { name: "OWNER" } }] }))).toBe(false);
    expect(isStaffUser(row({ roles: null }))).toBe(false);
    expect(isStaffUser(null)).toBe(false);
  });
});

describe("resolveLoginCandidates scoped (domain company)", () => {
  it("tries the company row before the staff row (password decides between them)", () => {
    const customerA = row({ id: "u-a", companyId: "c-a", roles: rolesOf("CUSTOMER") });
    const staffB = row({ id: "u-b", companyId: "c-b", roles: rolesOf("ADMIN") });
    expect(resolveLoginCandidates([staffB, customerA], "c-a").map((r) => r.id)).toEqual(["u-a", "u-b"]);
  });

  it("dedupes when the company row is itself staff (ADMIN of the domain company)", () => {
    const adminA = row({ id: "u-a", companyId: "c-a", roles: rolesOf("ADMIN") });
    expect(resolveLoginCandidates([adminA], "c-a").map((r) => r.id)).toEqual(["u-a"]);
  });

  it("falls back to the staff row when the company has no row for the email", () => {
    const staffB = row({ id: "u-b", companyId: "c-b", roles: rolesOf("ADMIN") });
    expect(resolveLoginCandidates([staffB], "c-a").map((r) => r.id)).toEqual(["u-b"]);
  });

  it("returns no candidates when neither the company nor staff holds the email", () => {
    const customerB = row({ id: "u-b", companyId: "c-b", roles: rolesOf("CUSTOMER") });
    expect(resolveLoginCandidates([customerB], "c-a")).toEqual([]);
    expect(resolveLoginCandidates([], "c-a")).toEqual([]);
  });
});

describe("resolveLoginCandidates unscoped (legacy hosts)", () => {
  it("prefers the staff row over any customer row (staff identity is never ambiguous)", () => {
    const staff = row({ id: "u-s", companyId: null, roles: rolesOf("SUPER_ADMIN") });
    const customer = row({ id: "u-c", companyId: "c-a", roles: rolesOf("CUSTOMER") });
    expect(resolveLoginCandidates([customer, staff], null).map((r) => r.id)).toEqual(["u-s"]);
  });

  it("resolves the single non-staff row (legacy single-identity behavior)", () => {
    const customer = row({ id: "u-c", companyId: null, roles: rolesOf("CUSTOMER") });
    expect(resolveLoginCandidates([customer], null).map((r) => r.id)).toEqual(["u-c"]);
    expect(resolveLoginCandidates([customer], undefined).map((r) => r.id)).toEqual(["u-c"]);
    expect(resolveLoginCandidates([customer], "").map((r) => r.id)).toEqual(["u-c"]);
  });

  it("fails closed on ambiguous non-staff rows (same email in several companies, no domain)", () => {
    const customerA = row({ id: "u-a", companyId: "c-a", roles: rolesOf("CUSTOMER") });
    const customerB = row({ id: "u-b", companyId: "c-b", roles: rolesOf("CUSTOMER") });
    expect(resolveLoginCandidates([customerA, customerB], null)).toEqual([]);
  });

  it("fails closed when nothing holds the email", () => {
    expect(resolveLoginCandidates([], null)).toEqual([]);
  });
});

describe("JWT shape invariant (no companyId in tokens)", () => {
  it("access and refresh claims carry no company identifier", () => {
    const access = signAccessToken({ id: "u-1", roles: ["CUSTOMER"] });
    const accessClaims = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString("utf8"));
    expect(accessClaims).not.toHaveProperty("companyId");
    expect(accessClaims.sub).toBe("u-1");
    const refresh = signRefreshToken("u-1");
    const refreshClaims = JSON.parse(Buffer.from(refresh.split(".")[1], "base64url").toString("utf8"));
    expect(refreshClaims).not.toHaveProperty("companyId");
    expect(refreshClaims.sub).toBe("u-1");
  });
});
