const notificationsService = require("./notifications.service");
const { notificationIdParamSchema, notificationListQuerySchema } = require("./notifications.validation");

async function list(req, res, next) {
  try {
    const query = notificationListQuerySchema.parse(req.query);
    const { notifications, unreadCount } = await notificationsService.listNotifications(
      req.user.id,
      query
    );
    return res
      .status(200)
      .json({ success: true, data: { notifications }, meta: { unreadCount } });
  } catch (err) {
    return next(err);
  }
}

async function unreadCount(req, res, next) {
  try {
    const { unreadCount } = await notificationsService.getUnreadCount(req.user.id);
    return res.status(200).json({ success: true, data: { unreadCount } });
  } catch (err) {
    return next(err);
  }
}

async function markRead(req, res, next) {
  try {
    const params = notificationIdParamSchema.parse({ id: req.params.id });
    const { notification, unreadCount } = await notificationsService.markRead(
      req.user.id,
      params.id
    );
    return res
      .status(200)
      .json({ success: true, data: { notification }, meta: { unreadCount } });
  } catch (err) {
    return next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    const { updated, unreadCount } = await notificationsService.markAllRead(req.user.id);
    return res
      .status(200)
      .json({ success: true, data: { updated }, meta: { unreadCount } });
  } catch (err) {
    return next(err);
  }
}

async function clear(req, res, next) {
  try {
    const params = notificationIdParamSchema.parse({ id: req.params.id });
    const { id, unreadCount } = await notificationsService.clearNotification(
      req.user.id,
      params.id
    );
    return res
      .status(200)
      .json({ success: true, data: { id }, meta: { unreadCount } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, unreadCount, markRead, markAllRead, clear };
