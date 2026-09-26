const express = require("express");

const cartController = require("./cart.controller");
const { authenticate } = require("../../middleware/authenticate");

const router = express.Router();

router.get("/", authenticate, cartController.get);
router.post("/items", authenticate, cartController.add);
router.patch("/items/:itemId", authenticate, cartController.update);
router.delete("/items/:itemId", authenticate, cartController.remove);

module.exports = router;
