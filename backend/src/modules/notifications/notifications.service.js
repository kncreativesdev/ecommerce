const notificationsRepository = require("./notifications.repository");
const { AppError } = require("../../utils/appError");

const DEFAULT_LIMIT = 20;

function toSafeNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    orderId: row.orderId ?? null,
    orderNumber: row.order?.orderNumber ?? null,
    isRead: row.isRead,
    createdAt: row.createdAt,
    readAt: row.readAt ?? null,
  };
}

async function listNotifications(userId, query) {
  const limit = query.limit ?? DEFAULT_LIMIT;
  const unreadOnly = query.unreadOnly === "true";
  const { rows, unreadCount } = await notificationsRepository.findNotificationsByUserId(userId, {
    limit,
    unreadOnly,
  });
  return {
    notifications: rows.map(toSafeNotification),
    unreadCount,
  };
}

async function getUnreadCount(userId) {
  const unreadCount = await notificationsRepository.countUnreadByUserId(userId);
  return { unreadCount };
}

async function markRead(userId, id) {
  const result = await notificationsRepository.markNotificationRead(userId, id);
  if (result.outcome === "missing") {
    throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
  }
  const unreadCount = await notificationsRepository.countUnreadByUserId(userId);
  return { notification: toSafeNotification(result.notification), unreadCount };
}

async function markAllRead(userId) {
  const updated = await notificationsRepository.markAllNotificationsRead(userId);
  return { updated, unreadCount: 0 };
}

async function clearNotification(userId, id) {
  const deleted = await notificationsRepository.deleteNotificationByIdAndUserId(id, userId);
  if (deleted === 0) {
    throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
  }
  const unreadCount = await notificationsRepository.countUnreadByUserId(userId);
  return { id, unreadCount };
}

module.exports = {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  clearNotification,
};
