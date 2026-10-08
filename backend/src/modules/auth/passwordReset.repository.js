const { prisma } = require("../../config/database");
const auditRepository = require("../audit/audit.repository");

const OTP_SELECT = {
  id: true,
  userId: true,
  purpose: true,
  otpHash: true,
  expiresAt: true,
  attempts: true,
  verifiedAt: true,
  usedAt: true,
  createdAt: true,
};

/**
 * Supersedes all prior codes for (user, purpose): a newer code is the
 * only live one. Deletion is invalidation — unexpired live secrets must
 * not accumulate.
 */
async function invalidateActiveOtps(userId, purpose, client = null) {
  const db = client || prisma;
  return db.passwordOtp.deleteMany({ where: { userId, purpose } });
}

async function createOtp({ userId, purpose, otpHash, expiresAt }, client = null) {
  const db = client || prisma;
  return db.passwordOtp.create({
    data: { userId, purpose, otpHash, expiresAt },
    select: OTP_SELECT,
  });
}

/**
 * Newest live row for (user, purpose). Callers enforce expiry, attempt
 * bounds, verification state, and single-use — this function only
 * reads; it never leaks the code (only the hash is selected).
 */
async function findLatestActiveOtp(userId, purpose) {
  return prisma.passwordOtp.findFirst({
    where: { userId, purpose, usedAt: null },
    orderBy: [{ createdAt: "desc" }],
    select: OTP_SELECT,
  });
}

async function incrementOtpAttempts(id) {
  return prisma.passwordOtp.update({
    where: { id },
    data: { attempts: { increment: 1 } },
    select: OTP_SELECT,
  });
}

async function markOtpVerified(id) {
  return prisma.passwordOtp.update({
    where: { id },
    data: { verifiedAt: new Date() },
    select: OTP_SELECT,
  });
}

/**
 * Atomic credential rotation: consumes the verified OTP, sets the new
 * Argon2id password hash plus the refresh-invalidation watermark, and
 * records the audit event in the same transaction — a rolled-back
 * rotation leaves no audit row and no consumed code behind.
 */
async function rotatePasswordTx({ userId, otpId, passwordHash, passwordChangedAt, audit }) {
  return prisma.$transaction(async (tx) => {
    await tx.passwordOtp.update({
      where: { id: otpId },
      data: { usedAt: new Date() },
    });
    const user = await tx.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt },
    });
    if (audit) {
      await auditRepository.createAuditEvent(
        { ...audit, resourceId: user.id },
        tx
      );
    }
    return user;
  });
}

module.exports = {
  invalidateActiveOtps,
  createOtp,
  findLatestActiveOtp,
  incrementOtpAttempts,
  markOtpVerified,
  rotatePasswordTx,
};
