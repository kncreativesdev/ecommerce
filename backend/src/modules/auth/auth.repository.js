const { prisma } = require("../../config/database");

const USER_WITH_ROLES = {
  roles: { include: { role: true } },
};

async function findUserByEmail(email) {
  return prisma.user.findUnique({
    where: { email },
    include: USER_WITH_ROLES,
  });
}

async function findUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    include: USER_WITH_ROLES,
  });
}

async function createUserWithRole(input, roleName) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
      },
    });

    let role = await tx.role.findUnique({ where: { name: roleName } });
    if (!role) {
      try {
        role = await tx.role.create({ data: { name: roleName } });
      } catch (err) {
        if (err.code !== "P2002") {
          throw err;
        }
        role = await tx.role.findUniqueOrThrow({ where: { name: roleName } });
      }
    }

    await tx.userRole.create({
      data: { userId: user.id, roleId: role.id },
    });

    return tx.user.findUniqueOrThrow({
      where: { id: user.id },
      include: USER_WITH_ROLES,
    });
  });
}

module.exports = { findUserByEmail, findUserById, createUserWithRole };
