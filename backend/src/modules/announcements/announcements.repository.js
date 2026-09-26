const { prisma } = require("../../config/database");

const ANNOUNCEMENT_SELECT = {
  id: true,
  message: true,
  isActive: true,
  startsAt: true,
  expiresAt: true,
  linkLabel: true,
  linkTarget: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
};

const PUBLIC_ANNOUNCEMENT_SELECT = {
  message: true,
  linkLabel: true,
  linkTarget: true,
};

async function findAllAnnouncementsAdmin() {
  return prisma.siteAnnouncement.findMany({
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    select: ANNOUNCEMENT_SELECT,
  });
}

async function findAnnouncementByIdAdmin(id) {
  return prisma.siteAnnouncement.findUnique({
    where: { id },
    select: ANNOUNCEMENT_SELECT,
  });
}

async function createAnnouncement(data) {
  return prisma.siteAnnouncement.create({
    data: {
      message: data.message,
      isActive: data.isActive ?? true,
      startsAt: data.startsAt ?? null,
      expiresAt: data.expiresAt ?? null,
      linkLabel: data.linkLabel ?? null,
      linkTarget: data.linkTarget ?? null,
      priority: data.priority ?? 0,
      createdBy: data.createdBy ?? null,
    },
    select: ANNOUNCEMENT_SELECT,
  });
}

async function updateAnnouncement(id, data) {
  try {
    return await prisma.siteAnnouncement.update({
      where: { id },
      data,
      select: ANNOUNCEMENT_SELECT,
    });
  } catch (err) {
    if (err.code === "P2025") {
      return null;
    }
    throw err;
  }
}

async function deleteAnnouncement(id) {
  try {
    await prisma.siteAnnouncement.delete({ where: { id } });
    return true;
  } catch (err) {
    if (err.code === "P2025") {
      return null;
    }
    throw err;
  }
}

/**
 * The single row the storefront shows: active AND in-window, highest
 * priority first, then newest. Returns null when nothing qualifies —
 * the customer hides the bar instead of falling back to hardcoded copy.
 */
async function findCurrentAnnouncement(now) {
  return prisma.siteAnnouncement.findFirst({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
      ],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    select: PUBLIC_ANNOUNCEMENT_SELECT,
  });
}

module.exports = {
  findAllAnnouncementsAdmin,
  findAnnouncementByIdAdmin,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  findCurrentAnnouncement,
};
