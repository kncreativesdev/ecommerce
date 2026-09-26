const { AppError } = require("../../utils/appError");
const usersRepository = require("./users.repository");
const { toSafeUser } = require("./users.utils");

async function loadActiveUser(userId) {
  const user = await usersRepository.findUserById(userId);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  if (!user.isActive) {
    throw new AppError(403, "AUTH_ACCOUNT_INACTIVE", "Account is inactive");
  }
  return user;
}

async function getProfile(userId) {
  const user = await loadActiveUser(userId);
  return toSafeUser(user);
}

const ADMIN_DEFAULT_PAGE = 1;
const ADMIN_DEFAULT_LIMIT = 20;
const ADMIN_MAX_LIMIT = 100;

async function listUsersAdmin(query) {
  const page = query.page ?? ADMIN_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? ADMIN_DEFAULT_LIMIT, ADMIN_MAX_LIMIT);
  const search = query.search ? query.search.trim() : "";
  const { rows, total } = await usersRepository.findUsersAdmin({
    search: search === "" ? null : search,
    isActive: query.isActive === undefined ? null : query.isActive === "true",
    sortBy: query.sortBy ?? "createdAt",
    sortOrder: query.sortOrder ?? "desc",
    skip: (page - 1) * limit,
    take: limit,
  });
  return {
    users: rows.map(toSafeUser),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function getUserAdmin(id) {
  const user = await usersRepository.findUserById(id);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  return toSafeUser(user);
}

async function setUserActiveAdmin(id, isActive) {
  try {
    const user = await usersRepository.setUserActive(id, isActive);
    return toSafeUser(user);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }
    throw err;
  }
}

async function updateProfile(userId, input) {
  await loadActiveUser(userId);

  const data = {};
  if (input.firstName !== undefined) {
    data.firstName = input.firstName;
  }
  if (input.lastName !== undefined) {
    data.lastName = input.lastName;
  }
  if (input.phone !== undefined) {
    data.phone = input.phone;
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(422, "USER_UPDATE_INVALID", "No updatable fields provided");
  }

  try {
    const updated = await usersRepository.updateUserProfile(userId, data);
    return toSafeUser(updated);
  } catch (err) {
    if (err.code === "P2025") {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }
    throw err;
  }
}

module.exports = { getProfile, updateProfile, listUsersAdmin, getUserAdmin, setUserActiveAdmin };
