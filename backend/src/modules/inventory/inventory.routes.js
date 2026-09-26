const express = require("express");

const inventoryController = require("./inventory.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");

const router = express.Router({ mergeParams: true });

router.get("/", authenticate, authorize("ADMIN"), inventoryController.get);
router.post("/", authenticate, authorize("ADMIN"), inventoryController.initialize);
router.patch("/", authenticate, authorize("ADMIN"), inventoryController.adjust);
router.get("/transactions", authenticate, authorize("ADMIN"), inventoryController.listTransactions);

module.exports = router;
