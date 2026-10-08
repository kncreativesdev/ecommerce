const express = require("express");

const wishlistController = require("./wishlist.controller");
const { authenticate } = require("../../middleware/authenticate");
const { resolveCompanyContext, requireActiveCompany } = require("../../middleware/companyContext");

const router = express.Router();

router.get("/", authenticate, resolveCompanyContext, requireActiveCompany, wishlistController.get);
router.post("/items", authenticate, resolveCompanyContext, requireActiveCompany, wishlistController.add);
router.delete("/items/:itemId", authenticate, resolveCompanyContext, requireActiveCompany, wishlistController.remove);

module.exports = router;
