-- CreateTable
CREATE TABLE `coupon_usages` (
    `id` CHAR(36) NOT NULL,
    `coupon_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `coupon_usages_order_id_key`(`order_id`),
    INDEX `coupon_usages_user_id_idx`(`user_id`),
    UNIQUE INDEX `coupon_usages_coupon_id_user_id_key`(`coupon_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `coupon_usages` ADD CONSTRAINT `coupon_usages_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_usages` ADD CONSTRAINT `coupon_usages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_usages` ADD CONSTRAINT `coupon_usages_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- SeedFirstUse: one row per historical (coupon_id, user_id) pair, tied to
-- the earliest order that used it. Live data inspection found 2 pairs with
-- 2 orders each (prior tests reused coupons); keeping the first use
-- preserves the legitimate history while the UNIQUE pair constraint
-- governs all future usage. Orders themselves are never touched.
-- Orders whose coupon was deleted (coupon_id SET NULL) seed nothing.
INSERT INTO `coupon_usages` (`id`, `coupon_id`, `user_id`, `order_id`, `created_at`)
SELECT UUID(), o.`coupon_id`, o.`user_id`, o.`id`, o.`created_at`
FROM `orders` o
WHERE o.`coupon_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `orders` o2
    WHERE o2.`coupon_id` = o.`coupon_id`
      AND o2.`user_id` = o.`user_id`
      AND (o2.`created_at` < o.`created_at` OR (o2.`created_at` = o.`created_at` AND o2.`id` < o.`id`))
  );
