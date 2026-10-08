/**
 * First platform SUPER_ADMIN provisioning (one-time operator bootstrap).
 *
 * This is a CLI command, never an HTTP endpoint: there is no route,
 * controller, or request contract for first-SUPER_ADMIN creation, and
 * the application never auto-creates one on startup.
 *
 * Usage: npm run bootstrap:super-admin
 *   BOOTSTRAP_SUPER_ADMIN_ENABLED=true
 *   BOOTSTRAP_SUPER_ADMIN_EMAIL=ops@example.com
 *   BOOTSTRAP_SUPER_ADMIN_PASSWORD=<secret, 8-128 chars>
 *   [BOOTSTRAP_SUPER_ADMIN_ALLOW_PRODUCTION=true]  # production only
 *
 * Safety gates (refuse loudly, never fall back, never default):
 * - runs only with BOOTSTRAP_SUPER_ADMIN_ENABLED=true;
 * - with NODE_ENV=production additionally requires
 *   BOOTSTRAP_SUPER_ADMIN_ALLOW_PRODUCTION=true;
 * - email/password are validated (same policy as auth registration);
 * - existing active SUPER_ADMIN email is a no-op success (idempotent);
 * - any other existing holder is refused (never elevated, never
 *   reactivated); inactive holders are refused (never reactivated).
 * Nothing is ever printed that resembles a secret: no password, hash,
 * token, or database credential appears in output or logs.
 */
require("dotenv/config");

const { z } = require("zod");
const { prisma } = require("../src/config/database");
const { provisionSuperAdmin } = require("../src/modules/users/users.service");

const emailSchema = z.string().trim().toLowerCase().email().max(255);

/**
 * Pure gate + input resolution over an env-like object (unit-testable,
 * no I/O). Returns `{ ok: true, config: { email, password } }` or
 * `{ ok: false, code, message }` with safe, non-secret messages.
 */
function resolveBootstrapConfig(envLike) {
  const env = envLike || {};
  if (env.BOOTSTRAP_SUPER_ADMIN_ENABLED !== "true") {
    return {
      ok: false,
      code: "BOOTSTRAP_DISABLED",
      message: "Refusing: set BOOTSTRAP_SUPER_ADMIN_ENABLED=true to run first-SUPER_ADMIN provisioning.",
    };
  }
  if (env.NODE_ENV === "production" && env.BOOTSTRAP_SUPER_ADMIN_ALLOW_PRODUCTION !== "true") {
    return {
      ok: false,
      code: "BOOTSTRAP_PRODUCTION_REFUSED",
      message:
        "Refusing: production provisioning requires BOOTSTRAP_SUPER_ADMIN_ALLOW_PRODUCTION=true alongside the enable gate.",
    };
  }
  const parsedEmail = emailSchema.safeParse(env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? "");
  if (!parsedEmail.success) {
    return { ok: false, code: "BOOTSTRAP_INVALID_EMAIL", message: "Refusing: BOOTSTRAP_SUPER_ADMIN_EMAIL is missing or invalid." };
  }
  const password = env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
  if (typeof password !== "string" || password === "") {
    return { ok: false, code: "BOOTSTRAP_MISSING_PASSWORD", message: "Refusing: BOOTSTRAP_SUPER_ADMIN_PASSWORD is missing." };
  }
  return { ok: true, config: { email: parsedEmail.data, password } };
}

async function main() {
  const resolved = resolveBootstrapConfig(process.env);
  if (!resolved.ok) {
    console.error(`${resolved.code}: ${resolved.message}`);
    try {
      await prisma.$disconnect();
    } catch {
      // Disconnect is best-effort on the failure path.
    }
    process.exit(1);
    return;
  }
  try {
    const { user, created } = await provisionSuperAdmin(resolved.config);
    if (created) {
      console.log(`SUPER_ADMIN provisioned for ${user.email} (id ${user.id}). Sign in to the Admin frontend with this account.`);
    } else {
      console.log(`SUPER_ADMIN already exists for ${user.email} (id ${user.id}). Nothing changed.`);
    }
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    try {
      await prisma.$disconnect();
    } catch {
      // Disconnect is best-effort on the failure path.
    }
    process.exit(1);
  }
}

module.exports = { resolveBootstrapConfig };

if (require.main === module) {
  main();
}
