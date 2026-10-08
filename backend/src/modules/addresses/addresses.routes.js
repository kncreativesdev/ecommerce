const express = require("express");

const addressesController = require("./addresses.controller");
const { authenticate } = require("../../middleware/authenticate");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

router.get("/", authenticate, resolveCompanyContext, requireActiveCompany, addressesController.list);
router.get("/:id", authenticate, resolveCompanyContext, requireActiveCompany, addressesController.getById);
router.post("/", authenticate, resolveCompanyContext, requireActiveCompany, addressesController.create);
router.patch("/:id", authenticate, resolveCompanyContext, requireActiveCompany, addressesController.update);
router.delete("/:id", authenticate, resolveCompanyContext, requireActiveCompany, addressesController.remove);

module.exports = router;
