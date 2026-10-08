const { prisma } = require("../../config/database");
const auditRepository = require("./audit.repository");

const RETENTION_ROW_ID = "global";
const CLEANUP_BATCH_SIZE = 1000;

async function findRetentionPolicy() {
  return prisma.auditRetentionPolicy.findUnique({
    where: { id: RETENTION_ROW_ID },
    select: { id: true, policy: true, updatedBy: true, createdAt: true, updatedAt: true },
  });
}

/**
 * Platform policy write + its audit event in one transaction: a
 * rolled-back policy change leaves no audit row behind (and a missing
 * audit write rolls the policy change back with it).
 */
async function setPolicyTx({ policy, updatedBy, audit }) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.auditRetentionPolicy.upsert({
      where: { id: RETENTION_ROW_ID },
      create: { id: RETENTION_ROW_ID, policy, updatedBy },
      update: { policy, updatedBy },
      select: { id: true, policy: true, updatedBy: true, createdAt: true, updatedAt: true },
    });
    if (audit) {
      await auditRepository.createAuditEvent(audit, tx);
    }
    return row;
  });
}

/**
 * One bounded delete batch: rows strictly older than the cutoff,
 * oldest first, capped at `batchSize`. Only the cutoff timestamp is
 * bound as a parameter; the limit is a server-side constant (never
 * client input). Returns the deleted row count.
 */
async function purgeAuditLogsBatch(cutoff, batchSize = CLEANUP_BATCH_SIZE) {
  const limit = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : CLEANUP_BATCH_SIZE;
  const deleted = await prisma.$executeRawUnsafe(
    "DELETE FROM `audit_logs` WHERE `created_at` < ? ORDER BY `created_at` ASC, `id` ASC LIMIT " + limit,
    cutoff
  );
  return Number(deleted);
}

module.exports = {
  RETENTION_ROW_ID,
  CLEANUP_BATCH_SIZE,
  findRetentionPolicy,
  setPolicyTx,
  purgeAuditLogsBatch,
};
