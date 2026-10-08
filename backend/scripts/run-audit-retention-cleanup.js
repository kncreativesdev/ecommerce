/**
 * One-shot audit retention cleanup (Phase 2C-19).
 *
 * Production scheduler invocation alternative to the in-process
 * worker started by src/server.js: run this script from the
 * platform cron/scheduler (e.g. daily) instead of — never in
 * addition to — the in-process worker when the deployment runs
 * multiple processes. Derives the policy server-side, deletes only
 * rows strictly older than the cutoff, writes no audit rows.
 *
 * Usage: npm run cleanup:audit-logs
 */
require("dotenv/config");

const { runRetentionCleanup } = require("../src/modules/audit/retention.service");
const { prisma } = require("../src/config/database");

async function main() {
  try {
    const result = await runRetentionCleanup();
    console.log(
      JSON.stringify({
        policy: result.policy,
        cutoff: result.cutoff ? result.cutoff.toISOString() : null,
        deleted: result.deleted,
      })
    );
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

main();
