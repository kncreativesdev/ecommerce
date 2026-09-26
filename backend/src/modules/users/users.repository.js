const { prisma } = require("../../config/database");

const USER_PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  roles: { include: { role: { select: { name: true } } } },
};

async function findUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: USER_PROFILE_SELECT,
  });
}

async function updateUserProfile(id, data) {
  return prisma.user.update({
    where: { id },
    data,
    select: USER_PROFILE_SELECT,
  });
}

/**
 * Admin user list. Every filter is explicit — callers pass a normalized
 * filter object (service layer), never raw query params. No ownership
 * predicate: ADMIN authorization is enforced by route middleware. The
 * safe select never exposes password hashes or tokens.
 */
async function findUsersAdmin(filters) {
  const { search, isActive, sortBy, sortOrder, skip, take } = filters;

  const and = [];
  if (isActive !== null && isActive !== undefined) {
    and.push({ isActive });
  }
  if (search) {
    and.push({
      OR: [
        { email: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
      ],
    });
  }

  const where = and.length > 0 ? { AND: and } : {};
  const orderBy = sortBy === "createdAt" ? [{ createdAt: sortOrder }] : [{ createdAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy,
      skip,
      take,
      select: USER_PROFILE_SELECT,
    }),
    prisma.user.count({ where }),
  ]);
  return { rows, total };
}

async function setUserActive(id, isActive) {
  return prisma.user.update({
    where: { id },
    data: { isActive },
    select: USER_PROFILE_SELECT,
  });
}

module.exports = { findUserById, updateUserProfile, findUsersAdmin, setUserActive };
