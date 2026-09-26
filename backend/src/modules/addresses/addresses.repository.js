const { prisma } = require("../../config/database");

const ADDRESS_SELECT = {
  id: true,
  label: true,
  fullName: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
};

async function findAddressesByUserId(userId) {
  return prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    select: ADDRESS_SELECT,
  });
}

async function findAddressByIdAndUserId(id, userId) {
  return prisma.address.findFirst({
    where: { id, userId },
    select: ADDRESS_SELECT,
  });
}

async function createAddress(userId, data) {
  if (data.isDefault !== true) {
    return prisma.address.create({
      data: { ...data, userId },
      select: ADDRESS_SELECT,
    });
  }

  return prisma.$transaction(async (tx) => {
    await tx.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
    return tx.address.create({
      data: { ...data, userId },
      select: ADDRESS_SELECT,
    });
  });
}

async function updateAddressByIdAndUserId(id, userId, data) {
  return prisma.$transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const result = await tx.address.updateMany({
      where: { id, userId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return tx.address.findUniqueOrThrow({
      where: { id },
      select: ADDRESS_SELECT,
    });
  });
}

async function deleteAddressByIdAndUserId(id, userId) {
  const result = await prisma.address.deleteMany({
    where: { id, userId },
  });
  return result.count;
}

module.exports = {
  findAddressesByUserId,
  findAddressByIdAndUserId,
  createAddress,
  updateAddressByIdAndUserId,
  deleteAddressByIdAndUserId,
};
