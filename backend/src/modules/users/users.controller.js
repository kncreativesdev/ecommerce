const usersService = require("./users.service");
const {
  updateProfileSchema,
  userIdParamSchema,
  adminUserListQuerySchema,
  updateUserActiveSchema,
  createEmployeeSchema,
  updateMemberProfileSchema,
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

/**
 * Server-resolved tenant for ADMIN customer management. The mounted
 * companyContext guarantees the value (or rejects the request first);
 * a missing value fails closed inside the service. Self-service
 * (/me) endpoints intentionally take no company — they operate on
 * req.user.id only.
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function listAdmin(req, res, next) {
  try {
    const query = adminUserListQuerySchema.parse(req.query);
    const { users, pagination } = await usersService.listUsersAdmin(companyIdOf(req), query, req.user.roles);
    return res.status(200).json({ success: true, data: { users }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function getByIdAdmin(req, res, next) {
  try {
    const params = userIdParamSchema.parse({ id: req.params.id });
    const user = await usersService.getUserAdmin(companyIdOf(req), params.id, req.user.roles);
    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
}

async function updateActiveAdmin(req, res, next) {
  try {
    const params = userIdParamSchema.parse({ id: req.params.id });
    const input = updateUserActiveSchema.parse(req.body);
    const user = await usersService.setUserActiveAdmin(
      companyIdOf(req),
      params.id,
      input.isActive,
      req.user.id,
      req.user.roles
    );
    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
}

/**
 * Phase 2C-31 HEAD/MEMBER management. The creator/manager identity
 * (id + company + roles) always derives from the authenticated
 * server-side context — the strict schemas above carry no companyId,
 * and `provisionEmployee`/`updateMemberProfileAdmin` enforce the
 * canManageRole hierarchy (ADMIN → HEAD/MEMBER, HEAD → MEMBER).
 */
async function createEmployee(req, res, next) {
  try {
    const input = createEmployeeSchema.parse(req.body);
    const user = await usersService.provisionEmployee(
      { id: req.user.id, companyId: companyIdOf(req), roles: req.user.roles },
      input
    );
    return res.status(201).json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
}

async function updateMemberProfile(req, res, next) {
  try {
    const params = userIdParamSchema.parse({ id: req.params.id });
    const input = updateMemberProfileSchema.parse(req.body);
    const user = await usersService.updateMemberProfileAdmin(companyIdOf(req), params.id, input, {
      id: req.user.id,
      roles: req.user.roles,
    });
    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getMe, updateMe, listAdmin, getByIdAdmin, updateActiveAdmin, createEmployee, updateMemberProfile };
