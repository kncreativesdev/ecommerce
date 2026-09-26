const { prisma } = require("../../config/database");

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  message: true,
  orderId: true,
  isRead: true,
  createdAt: true,
  readAt: true,
};

async function findNotificationsByUserId(userId, { limit, unreadOnly }) {
  const where = unreadOnly ? { userId, isRead: false } : { userId };
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { ...NOTIFICATION_SELECT, order: { select: { orderNumber: true } } },
    }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  return { rows, unreadCount };
}

async function countUnreadByUserId(userId) {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

async function markNotificationRead(userId, id) {
  const existing = await prisma.notification.findFirst({
    where: { id, userId },
    select: { id: true, isRead: true },
  });
  if (!existing) {
    return { outcome: "missing" };
  }
  if (existing.isRead) {
    const row = await prisma.notification.findUnique({
      where: { id },
      select: { ...NOTIFICATION_SELECT, order: { select: { orderNumber: true } } },
    });
    return { outcome: "ok", notification: row, alreadyRead: true };
  }
  const row = await prisma.notification.update({
    where: { id },
    data: { isRead: true, readAt: new Date() },
    select: { ...NOTIFICATION_SELECT, order: { select: { orderNumber: true } } },
  });
  return { outcome: "ok", notification: row, alreadyRead: false };
}

async function markAllNotificationsRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return result.count;
}

async function deleteNotificationByIdAndUserId(id, userId) {
  const result = await prisma.notification.deleteMany({
    where: { id, userId },
  });
  return result.count;
}

module.exports = {
  findNotificationsByUserId,
  countUnreadByUserId,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotificationByIdAndUserId,
};
