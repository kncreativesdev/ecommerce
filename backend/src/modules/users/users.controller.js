const usersService = require("./users.service");
const {
  updateProfileSchema,
  userIdParamSchema,
  adminUserListQuerySchema,
  updateUserActiveSchema,
} = require("./users.validation");

async function getMe(req, res, next) {
  try {
    const user = await usersService.getProfile(req.user.id);
    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    const input = updateProfileSchema.parse(req.body);
    const user = await usersService.updateProfile(req.user.id, input);
    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
}

async function listAdmin(req, res, next) {
  try {
    const query = adminUserListQuerySchema.parse(req.query);
    const { users, pagination } = await usersService.listUsersAdmin(query);
    return res.status(200).json({ success: true, data: { users }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function getByIdAdmin(req, res, next) {
  try {
    const params = userIdParamSchema.parse({ id: req.params.id });
    const user = await usersService.getUserAdmin(params.id);
    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
}

async function updateActiveAdmin(req, res, next) {
  try {
    const params = userIdParamSchema.parse({ id: req.params.id });
    const input = updateUserActiveSchema.parse(req.body);
    const user = await usersService.setUserActiveAdmin(params.id, input.isActive);
    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getMe, updateMe, listAdmin, getByIdAdmin, updateActiveAdmin };
