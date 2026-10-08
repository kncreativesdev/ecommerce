import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";

import {
  resolveCompanyContext,
  decideCompanyContext,
  getCompanyContext,
  isPlatformContext,
  hasClientCompanyId,
} from "../../src/middleware/companyContext.js";
import { signAccessToken } from "../../src/utils/jwt.js";

/**
 * Phase 2A company-context boundary tests (no database).
 *
 * `decideCompanyContext` is pure, so every fail-closed branch is pinned
 * here with plain record fixtures. Live-database resolution is covered
 * by tests/integration/company-context.test.js. JWT shape is asserted
 * here to lock the "no companyId in tokens" invariant.
 */

const COMPANY = { id: "c-1", name: "Tech Pulse", status: "ACTIVE", adminUserId: "u-admin" };

function record(overrides = {}) {
  return {
    id: "u-1",
    companyId: "c-1",
    roles: [{ role: { name: "CUSTOMER" } }],
    company: { ...COMPANY },
    ...overrides,
  };
}

describe("decideCompanyContext fail-closed branches", () => {
  it("rejects missing records without an existence signal", () => {
    for (const rec of [null, undefined]) {
      expect(decideCompanyContext(rec)).toMatchObject({ ok: false, statusCode: 401, code: "AUTH_UNAUTHORIZED" });
    }
  });

  it("rejects company users with no roles", () => {
    expect(decideCompanyContext(record({ roles: [] }))).toMatchObject({
      ok: false,
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
  });

  it("rejects non-SUPER_ADMIN users with null companyId", () => {
    expect(decideCompanyContext(record({ companyId: null, company: null }))).toMatchObject({
      ok: false,
      statusCode: 403,
      code: "AUTH_COMPANY_REQUIRED",
    });
  });

  it("rejects dangling company references without falling back", () => {
    expect(decideCompanyContext(record({ companyId: "gone", company: null }))).toMatchObject({
      ok: false,
      statusCode: 403,
      code: "AUTH_COMPANY_INVALID",
    });
  });

  it("rejects ADMIN users inconsistent with Company.adminUserId", () => {
    expect(
      decideCompanyContext(record({ id: "u-2", roles: [{ role: { name: "ADMIN" } }] }))
    ).toMatchObject({ ok: false, statusCode: 403, code: "AUTH_COMPANY_INCONSISTENT" });
  });

  it("rejects ADMIN users while adminUserId is still null (bootstrap)", () => {
    expect(
      decideCompanyContext(
        record({
          id: "u-2",
          roles: [{ role: { name: "ADMIN" } }],
          company: { ...COMPANY, adminUserId: null },
        })
      )
    ).toMatchObject({ ok: false, statusCode: 403, code: "AUTH_COMPANY_INCONSISTENT" });
  });
});

describe("decideCompanyContext success paths", () => {
  it("resolves a CUSTOMER to its database company", () => {
    const decision = decideCompanyContext(record());
    expect(decision.ok).toBe(true);
    expect(decision.context).toEqual({
      companyId: "c-1",
      company: { id: "c-1", name: "Tech Pulse", status: "ACTIVE" },
      isPlatformContext: false,
      source: "identity",
    });
  });

  it("resolves the consistent ADMIN to its company", () => {
    const decision = decideCompanyContext(
      record({ id: "u-admin", roles: [{ role: { name: "ADMIN" } }] })
    );
    expect(decision.ok).toBe(true);
    expect(decision.context.companyId).toBe("c-1");
  });

  it("gives SUPER_ADMIN platform context even with null companyId", () => {
    const decision = decideCompanyContext(
      record({ id: "u-sa", companyId: null, company: null, roles: [{ role: { name: "SUPER_ADMIN" } }] })
    );
    expect(decision.ok).toBe(true);
    expect(decision.context).toEqual({ companyId: null, company: null, isPlatformContext: true, source: "platform" });
  });

  it("gives SUPER_ADMIN platform context even when the row carries a companyId", () => {
    const decision = decideCompanyContext(
      record({ id: "u-sa", roles: [{ role: { name: "SUPER_ADMIN" } }] })
    );
    expect(decision.ok).toBe(true);
    expect(decision.context.isPlatformContext).toBe(true);
  });

  it("exposes SUSPENDED status in the resolved context", () => {
    const decision = decideCompanyContext(
      record({ company: { ...COMPANY, status: "SUSPENDED" } })
    );
    expect(decision.ok).toBe(true);
    expect(decision.context.company.status).toBe("SUSPENDED");
  });
});

describe("resolveCompanyContext middleware shell", () => {
  it("rejects requests without an authenticated identity before any lookup", async () => {
    for (const req of [{}, { user: null }, { user: { id: "" } }, { user: {} }]) {
      const err = await new Promise((resolve) => {
        resolveCompanyContext(req, {}, (e) => resolve(e));
      });
      expect(err).toMatchObject({ statusCode: 401, code: "AUTH_UNAUTHORIZED" });
      expect(getCompanyContext(req)).toBeNull();
    }
  });

  it("never reads client-supplied companyId (detector contract)", () => {
    const req = {
      query: { companyId: "c-evil" },
      body: { companyId: "c-evil" },
      headers: { "x-company-id": "c-evil" },
    };
    expect(hasClientCompanyId(req)).toBe(true);
    expect(isPlatformContext(req)).toBe(false);
  });
});

describe("JWT payload shape (no companyId)", () => {
  it("signs access tokens with only sub/roles (+iat/exp)", () => {
    const token = signAccessToken({ id: "u-1", roles: ["CUSTOMER"] });
    const payload = jwt.decode(token);
    expect(payload.sub).toBe("u-1");
    expect(payload.roles).toEqual(["CUSTOMER"]);
    expect(payload).not.toHaveProperty("companyId");
    expect(payload).not.toHaveProperty("company");
    for (const key of Object.keys(payload)) {
      expect(["sub", "roles", "iat", "exp"]).toContain(key);
    }
  });
});
