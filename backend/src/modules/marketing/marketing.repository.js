const { prisma } = require("../../config/database");

const MARKETING_SELECT = {
  id: true,
  title: true,
  message: true,
  type: true,
  isActive: true,
  startsAt: true,
  expiresAt: true,
  linkType: true,
  linkValue: true,
  createdAt: true,
  updatedAt: true,
};

async function findAllMarketingAdmin() {
  return prisma.marketingNotification.findMany({
    orderBy: { createdAt: "desc" },
    select: MARKETING_SELECT,
  });
}

async function findMarketingByIdAdmin(id) {
  return prisma.marketingNotification.findUnique({
    where: { id },
    select: MARKETING_SELECT,
  });
}

async function createMarketing(data) {
  return prisma.marketingNotification.create({
    data: {
      title: data.title,
      message: data.message,
      type: data.type ?? "OFFER",
      isActive: data.isActive ?? true,
      startsAt: data.startsAt ?? null,
      expiresAt: data.expiresAt ?? null,
      linkType: data.linkType ?? null,
      linkValue: data.linkValue ?? null,
      createdBy: data.createdBy ?? null,
    },
    select: MARKETING_SELECT,
  });
}

async function updateMarketing(id, data) {
  try {
    return await prisma.marketingNotification.update({
      where: { id },
      data,
      select: MARKETING_SELECT,
    });
  } catch (err) {
    if (err.code === "P2025") {
      return null;
    }
    throw err;
  }
}

async function deleteMarketing(id) {
  try {
    await prisma.marketingNotification.delete({ where: { id } });
    return true;
  } catch (err) {
    if (err.code === "P2025") {
      return null;
    }
    throw err;
  }
}

/**
 * Currently visible broadcasts: active AND within the optional
 * [startsAt, expiresAt] window. Newest first.
 */
async function findActiveMarketing(now) {
  return prisma.marketingNotification.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      message: true,
      type: true,
      linkType: true,
      linkValue: true,
      startsAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });
}

module.exports = {
  findAllMarketingAdmin,
  findMarketingByIdAdmin,
  createMarketing,
  updateMarketing,
  deleteMarketing,
  findActiveMarketing,
};
