const express = require("express");

const ordersController = require("./orders.controller");
const { authenticate } = require("../../middleware/authenticate");
const { authorize } = require("../../middleware/authorize");

const router = express.Router();

// Admin operations (authenticated + ADMIN). Declared before `/:id` so the
// literal `admin` segment is never captured as an order id. Customer
// checkout/history routes below are unchanged.
router.get("/admin", authenticate, authorize("ADMIN"), ordersController.listAdmin);
router.patch("/admin/bulk-status", authenticate, authorize("ADMIN"), ordersController.bulkUpdateStatusAdmin);
router.get("/admin/:id", authenticate, authorize("ADMIN"), ordersController.getByIdAdmin);
router.patch("/admin/:id/status", authenticate, authorize("ADMIN"), ordersController.updateStatusAdmin);
router.patch(
  "/admin/:id/payment",
  authenticate,
  authorize("ADMIN"),
  ordersController.updatePaymentAdmin
);

router.post("/", authenticate, ordersController.create);
router.get("/", authenticate, ordersController.list);
router.get("/:id", authenticate, ordersController.getById);

module.exports = router;
