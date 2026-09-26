const express = require("express");

const wishlistController = require("./wishlist.controller");
const { authenticate } = require("../../middleware/authenticate");

const router = express.Router();

router.get("/", authenticate, wishlistController.get);
router.post("/items", authenticate, wishlistController.add);
router.delete("/items/:itemId", authenticate, wishlistController.remove);

module.exports = router;
