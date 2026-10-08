import { describe, it, expect } from "vitest";

import { resolveBootstrapConfig } from "../../scripts/bootstrap-super-admin.js";

/**
 * First-SUPER_ADMIN bootstrap gate + input resolution (pure unit
 * coverage — no database, no I/O). Creation behavior itself is covered
 * by tests/integration/super-admin-bootstrap.test.js against the live
 * MySQL conventions used by every other integration suite.
 */
describe("bootstrap gate", () => {
  it("refuses unless the explicit enable gate is exactly true", async () => {
    for (const enabled of [undefined, "", "false", "1", "yes", true]) {
      expect(
        resolveBootstrapConfig({
          NODE_ENV: "development",
          BOOTSTRAP_SUPER_ADMIN_ENABLED: enabled,
          BOOTSTRAP_SUPER_ADMIN_EMAIL: "ops@example.test",
          BOOTSTRAP_SUPER_ADMIN_PASSWORD: "LongEnough123!",
        })
      ).toMatchObject({ ok: false, code: "BOOTSTRAP_DISABLED" });
    }
  });

  it("refuses production without the separate production authorization", async () => {
    for (const allow of [undefined, "", "false"]) {
      expect(
        resolveBootstrapConfig({
          NODE_ENV: "production",
          BOOTSTRAP_SUPER_ADMIN_ENABLED: "true",
          BOOTSTRAP_SUPER_ADMIN_ALLOW_PRODUCTION: allow,
          BOOTSTRAP_SUPER_ADMIN_EMAIL: "ops@example.test",
          BOOTSTRAP_SUPER_ADMIN_PASSWORD: "LongEnough123!",
        })
      ).toMatchObject({ ok: false, code: "BOOTSTRAP_PRODUCTION_REFUSED" });
    }
  });

  it("authorizes production only with both explicit flags", async () => {
    expect(
      resolveBootstrapConfig({
        NODE_ENV: "production",
        BOOTSTRAP_SUPER_ADMIN_ENABLED: "true",
        BOOTSTRAP_SUPER_ADMIN_ALLOW_PRODUCTION: "true",
        BOOTSTRAP_SUPER_ADMIN_EMAIL: "ops@example.test",
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: "LongEnough123!",
      }).ok
    ).toBe(true);
  });
});

describe("bootstrap input validation", () => {
  const enabled = {
    NODE_ENV: "development",
    BOOTSTRAP_SUPER_ADMIN_ENABLED: "true",
  };

  it("refuses invalid email", async () => {
    for (const email of ["", "not-an-email", "a@b", "x".repeat(250) + "@example.test"]) {
      expect(
        resolveBootstrapConfig({ ...enabled, BOOTSTRAP_SUPER_ADMIN_EMAIL: email, BOOTSTRAP_SUPER_ADMIN_PASSWORD: "LongEnough123!" })
      ).toMatchObject({ ok: false, code: "BOOTSTRAP_INVALID_EMAIL" });
    }
  });

  it("refuses missing password", async () => {
    for (const password of [undefined, ""]) {
      expect(
        resolveBootstrapConfig({ ...enabled, BOOTSTRAP_SUPER_ADMIN_EMAIL: "ops@example.test", BOOTSTRAP_SUPER_ADMIN_PASSWORD: password })
      ).toMatchObject({ ok: false, code: "BOOTSTRAP_MISSING_PASSWORD" });
    }
  });

  it("normalizes email like the auth contract and passes the password through untouched", async () => {
    const resolved = resolveBootstrapConfig({
      ...enabled,
      BOOTSTRAP_SUPER_ADMIN_EMAIL: "  Ops@Example.Test  ",
      BOOTSTRAP_SUPER_ADMIN_PASSWORD: "  Spaced Secret 123!  ",
    });
    expect(resolved).toMatchObject({ ok: true });
    expect(resolved.config.email).toBe("ops@example.test");
    // Password whitespace is significant — never trimmed or altered here.
    expect(resolved.config.password).toBe("  Spaced Secret 123!  ");
  });

  it("refuses with missing configuration", async () => {
    expect(resolveBootstrapConfig({})).toMatchObject({ ok: false, code: "BOOTSTRAP_DISABLED" });
    expect(resolveBootstrapConfig(null)).toMatchObject({ ok: false, code: "BOOTSTRAP_DISABLED" });
  });
});
