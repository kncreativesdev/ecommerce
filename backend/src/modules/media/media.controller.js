const mediaService = require("./media.service");
const { uploadMetadataSchema, updateMetadataSchema } = require("./media.validation");

async function list(req, res, next) {
  try {
    const images = await mediaService.listImages(req.params.productId);
    return res.status(200).json({ success: true, data: images });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const image = await mediaService.getImage(req.params.productId, req.params.imageId);
    return res.status(200).json({ success: true, data: { image } });
  } catch (err) {
    return next(err);
  }
}

async function upload(req, res, next) {
  try {
    const meta = uploadMetadataSchema.parse(req.body || {});
    const image = await mediaService.uploadImage(req.params.productId, req.file, meta);
    return res.status(201).json({ success: true, data: { image } });
  } catch (err) {
    return next(err);
  }
}

async function updateMetadata(req, res, next) {
  try {
    const input = updateMetadataSchema.parse(req.body);
    const image = await mediaService.updateImageMetadata(
      req.params.productId,
      req.params.imageId,
      input
    );
    return res.status(200).json({ success: true, data: { image } });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const result = await mediaService.removeImage(req.params.productId, req.params.imageId);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, upload, updateMetadata, remove };
