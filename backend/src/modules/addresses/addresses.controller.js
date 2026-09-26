const addressesService = require("./addresses.service");
const { createAddressSchema, updateAddressSchema } = require("./addresses.validation");

async function list(req, res, next) {
  try {
    const addresses = await addressesService.listAddresses(req.user.id);
    return res.status(200).json({ success: true, data: addresses });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const address = await addressesService.getAddress(req.user.id, req.params.id);
    return res.status(200).json({ success: true, data: { address } });
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const input = createAddressSchema.parse(req.body);
    const address = await addressesService.createAddress(req.user.id, input);
    return res.status(201).json({ success: true, data: { address } });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const input = updateAddressSchema.parse(req.body);
    const address = await addressesService.updateAddress(req.user.id, req.params.id, input);
    return res.status(200).json({ success: true, data: { address } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const result = await addressesService.deleteAddress(req.user.id, req.params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, remove };
