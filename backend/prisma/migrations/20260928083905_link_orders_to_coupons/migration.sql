-- AlterTable
ALTER TABLE `orders` ADD COLUMN `coupon_id` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `orders_coupon_id_idx` ON `orders`(`coupon_id`);

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
