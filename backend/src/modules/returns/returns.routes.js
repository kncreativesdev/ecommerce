const express = require("express");

const returnsController = require("./returns.controller");
const { authenticate } = require("../../middleware/authenticate");

const router = express.Router({ mergeParams: true });

router.post("/", authenticate, returnsController.create);
router.get("/", authenticate, returnsController.get);

module.exports = router;
