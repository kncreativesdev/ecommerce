const { AppError } = require("../../utils/appError");
const { logger } = require("../../utils/logger");
const { env } = require("../../config/env");
const retentionRepository = require("./retention.repository");
const { purgeExpiredRefreshSessions } = require("../auth/auth.repository");
const { assertAuditInput, resolveActorSnapshot } = require("./audit.service");

/**
 * Global audit retention (Phase 2C-19).
 *
 * The ONLY supported policies — the server owns this vocabulary, so
 * arbitrary days/months/dates can never be expressed. A year is
 * exactly 365 days (no calendar math). Cutoff rule: rows with
 * createdAt STRICTLY older than (now - N days) are eligible; rows
 * exactly at the boundary survive. All timestamps are UTC epoch
 * milliseconds compared in the database.
 */

const RETENTION_POLICIES = Object.freeze(["NEVER", "30_DAYS", "1_YEAR"]);

const RETENTION_DAYS = Object.freeze({
  NEVER: null,
  "30_DAYS": 30,
  "1_YEAR": 365,
});

// Server-owned presentation copy (order-notification precedent:
// frontends never duplicate these strings).
const RETENTION_DESCRIPTIONS = Object.freeze({
  NEVER: "Audit logs are retained indefinitely.",
  "30_DAYS": "Audit logs are deleted after 30 days.",
  "1_YEAR": "Audit logs are deleted after 1 year.",
});

const CLEANUP_BATCH_SIZE = 1000;

function describePolicy(policy) {
  return RETENTION_DESCRIPTIONS[policy] ?? RETENTION_DESCRIPTIONS.NEVER;
}

async function getRetentionPolicy() {
  const row = await retentionRepository.findRetentionPolicy();
  // Fail closed: an unrecognized stored value (only writable by hand,
  // since every writer validates) behaves as NEVER — cleanup must
  // never delete on an ambiguous policy.
  const policy = row && RETENTION_POLICIES.includes(row.policy) ? row.policy : "NEVER";
  return {
    policy,
    description: describePolicy(policy),
    updatedAt: row ? row.updatedAt : null,
    updatedBy: row ? row.updatedBy : null,
  };
}

async function setRetentionPolicy(policy, actor) {
  if (!RETENTION_POLICIES.includes(policy)) {
    throw new AppError(422, "AUDIT_INVALID_RETENTION", "Audit retention policy is not supported");
  }
  if (!actor || typeof actor.id !== "string" || actor.id === "") {
    throw new AppError(401, "AUTH_UNAUTHORIZED", "Authentication required");
  }
  const current = await getRetentionPolicy();
  if (current.policy === policy) {
    // Idempotent same-value update: success without a new audit row
    // (no policy change happened, so there is nothing to record).
    return { ...current, changed: false };
  }
  const snapshot = await resolveActorSnapshot(actor.id);
  const audit = assertAuditInput({
    actorId: snapshot.id,
    actorRole: snapshot.role,
    actorEmail: snapshot.email,
    companyId: null,
    action: "UPDATED",
    resource: "AUDIT_RETENTION",
    resourceId: null,
    outcome: "SUCCESS",
    details: { previousPolicy: current.policy, newPolicy: policy },
  });
  const row = await retentionRepository.setPolicyTx({ policy, updatedBy: snapshot.id, audit });
  return {
    policy: row.policy,
    description: describePolicy(row.policy),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    changed: true,
  };
}

function retentionCutoff(policy, now = new Date()) {
  const days = RETENTION_DAYS[policy];
  if (!days) {
    return null;
  }
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return new Date(time - days * 24 * 60 * 60 * 1000);
}

/**
 * Policy-driven purge. Derives the policy server-side, uses createdAt
 * only, deletes in bounded batches without loading rows into memory,
 * writes no audit rows of its own, and is safe to repeat (including
 * with zero eligible rows). NEVER deletes nothing by construction.
 */
async function runRetentionCleanup(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const { policy } = await getRetentionPolicy();
  const cutoff = retentionCutoff(policy, now);
  if (!cutoff) {
    return { policy, cutoff: null, deleted: 0 };
  }
  let deleted = 0;
  for (;;) {
    const batch = await retentionRepository.purgeAuditLogsBatch(cutoff, CLEANUP_BATCH_SIZE);
    deleted += batch;
    if (batch < CLEANUP_BATCH_SIZE) {
      break;
    }
  }
  return { policy, cutoff, deleted };
}

let schedulerHandle = null;

/**
 * Single in-process cleanup worker (one deployment = one scheduler —
 * the agreed SaaS topology). Guarded against duplicate starts within
 * the process, started only from server.js (never on app import, so
 * tests and scripts stay side-effect free), first run one interval
 * after boot (never before configuration/database init), errors
 * logged without crashing (counts only — never audit contents).
 */
function startRetentionScheduler({ intervalMs = env.auditCleanupIntervalMs } = {}) {
  if (schedulerHandle) {
    return schedulerHandle;
  }
  const tick = async () => {
    try {
      const result = await runRetentionCleanup();
      if (result.deleted > 0) {
        logger.info(
          { policy: result.policy, deleted: result.deleted },
          "Audit retention cleanup completed"
        );
      }
    } catch (err) {
      logger.error({ err: err && err.message ? err.message : String(err) }, "Audit retention cleanup failed");
    }
    // Refresh-session expiry sweep rides the same tick (same
    // single-instance topology, same error tolerance): one indexed
    // range delete of sessions no token can use anymore. Revoked and
    // per-user dead rows are additionally pruned at issuance time, so
    // this sweep only covers dormant accounts.
    try {
      const purged = await purgeExpiredRefreshSessions(new Date());
      if (purged > 0) {
        logger.info({ purged }, "Expired refresh sessions purged");
      }
    } catch (err) {
      logger.error({ err: err && err.message ? err.message : String(err) }, "Refresh session purge failed");
    }
  };
  schedulerHandle = setInterval(() => {
    void tick();
  }, intervalMs);
  if (schedulerHandle && typeof schedulerHandle.unref === "function") {
    schedulerHandle.unref();
  }
  return schedulerHandle;
}

function stopRetentionScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}

module.exports = {
  RETENTION_POLICIES,
  RETENTION_DAYS,
  RETENTION_DESCRIPTIONS,
  CLEANUP_BATCH_SIZE,
  getRetentionPolicy,
  setRetentionPolicy,
  retentionCutoff,
  runRetentionCleanup,
  startRetentionScheduler,
  stopRetentionScheduler,
};
