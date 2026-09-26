const express = require("express");

const addressesController = require("./addresses.controller");
const { authenticate } = require("../../middleware/authenticate");

const router = express.Router();

router.get("/", authenticate, addressesController.list);
router.get("/:id", authenticate, addressesController.getById);
router.post("/", authenticate, addressesController.create);
router.patch("/:id", authenticate, addressesController.update);
router.delete("/:id", authenticate, addressesController.remove);

module.exports = router;
