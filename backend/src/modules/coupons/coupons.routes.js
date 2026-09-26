const express = require("express");

const couponsController = require("./coupons.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");

const router = express.Router();

// Customer checkout preview (any authenticated role): validates a code
// against the CALLER'S cart and returns the authoritative discount quote.
// Declared before `/:id` for clarity (literal segment, POST-only here).
router.post("/validate", authenticate, couponsController.validateForCart);

// Coupon management is ADMIN-only (no other customer coupon endpoints;
// the internal validation/consumption service stays checkout-agnostic).
router.get("/", authenticate, authorize("ADMIN"), couponsController.list);
router.get("/:id", authenticate, authorize("ADMIN"), couponsController.getById);
router.post("/", authenticate, authorize("ADMIN"), couponsController.create);
router.patch("/:id", authenticate, authorize("ADMIN"), couponsController.update);
router.delete("/:id", authenticate, authorize("ADMIN"), couponsController.remove);

module.exports = router;
