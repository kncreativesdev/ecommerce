const express = require("express");

const cartController = require("./cart.controller");
const { authenticate } = require("../../middleware/authenticate");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

router.get("/", authenticate, resolveCompanyContext, requireActiveCompany, cartController.get);
router.post("/items", authenticate, resolveCompanyContext, requireActiveCompany, cartController.add);
router.patch("/items/:itemId", authenticate, resolveCompanyContext, requireActiveCompany, cartController.update);
router.delete("/items/:itemId", authenticate, resolveCompanyContext, requireActiveCompany, cartController.remove);

module.exports = router;
