const express = require("express");

const authRoutes = require("../modules/auth/auth.routes");
const usersRoutes = require("../modules/users/users.routes");
const addressesRoutes = require("../modules/addresses/addresses.routes");
const categoriesRoutes = require("../modules/categories/categories.routes");
const productsRoutes = require("../modules/products/products.routes");
const inventoryRoutes = require("../modules/inventory/inventory.routes");
const mediaRoutes = require("../modules/media/media.routes");
const cartRoutes = require("../modules/cart/cart.routes");
const wishlistRoutes = require("../modules/wishlist/wishlist.routes");
const ordersRoutes = require("../modules/orders/orders.routes");
const notificationsRoutes = require("../modules/notifications/notifications.routes");
const marketingRoutes = require("../modules/marketing/marketing.routes");
const announcementsRoutes = require("../modules/announcements/announcements.routes");
const reviewsRoutes = require("../modules/reviews/reviews.routes");
const couponsRoutes = require("../modules/coupons/coupons.routes");
const dashboardRoutes = require("../modules/dashboard/dashboard.routes");
const inventoryAdminRoutes = require("../modules/inventory/inventory.admin.routes");

const router = express.Router();

router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: "healthy",
    },
  });
});

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/addresses", addressesRoutes);
router.use("/categories", categoriesRoutes);
router.use("/products", productsRoutes);
router.use("/products/:productId/variants/:variantId/inventory", inventoryRoutes);
router.use("/products/:productId/images", mediaRoutes);
router.use("/cart", cartRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/orders", ordersRoutes);
router.use("/notifications", notificationsRoutes);
router.use("/marketing/notifications", marketingRoutes);
router.use("/announcements", announcementsRoutes);
router.use("/reviews", reviewsRoutes);
router.use("/coupons", couponsRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/inventory", inventoryAdminRoutes);

module.exports = router;
