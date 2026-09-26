const { AppError } = require("../../utils/appError");
const addressesRepository = require("./addresses.repository");
const { toSafeAddress } = require("./addresses.utils");

const UPDATABLE_FIELDS = [
  "label",
  "fullName",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  "isDefault",
];

async function listAddresses(userId) {
  const rows = await addressesRepository.findAddressesByUserId(userId);
  return rows.map(toSafeAddress);
}

async function getAddress(userId, id) {
  const row = await addressesRepository.findAddressByIdAndUserId(id, userId);
  if (!row) {
    throw new AppError(404, "ADDRESS_NOT_FOUND", "Address not found");
  }
  return toSafeAddress(row);
}

async function createAddress(userId, input) {
  const row = await addressesRepository.createAddress(userId, {
    label: input.label ?? null,
    fullName: input.fullName,
    phone: input.phone,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    isDefault: input.isDefault ?? false,
  });
  return toSafeAddress(row);
}

async function updateAddress(userId, id, input) {
  const data = {};
  for (const field of UPDATABLE_FIELDS) {
    if (input[field] !== undefined) {
      data[field] = input[field];
    }
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(422, "ADDRESS_UPDATE_INVALID", "No updatable fields provided");
  }

  const row = await addressesRepository.updateAddressByIdAndUserId(id, userId, data);
  if (!row) {
    throw new AppError(404, "ADDRESS_NOT_FOUND", "Address not found");
  }
  return toSafeAddress(row);
}

async function deleteAddress(userId, id) {
  const deleted = await addressesRepository.deleteAddressByIdAndUserId(id, userId);
  if (deleted === 0) {
    throw new AppError(404, "ADDRESS_NOT_FOUND", "Address not found");
  }
  return { id, message: "Address deleted successfully" };
}

module.exports = { listAddresses, getAddress, createAddress, updateAddress, deleteAddress };
