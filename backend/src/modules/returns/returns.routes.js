const express = require("express");

const returnsController = require("./returns.controller");
const { authenticate } = require("../../middleware/authenticate");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router({ mergeParams: true });

router.post("/", authenticate, resolveCompanyContext, requireActiveCompany, returnsController.create);
router.get("/", authenticate, resolveCompanyContext, requireActiveCompany, returnsController.get);

module.exports = router;
