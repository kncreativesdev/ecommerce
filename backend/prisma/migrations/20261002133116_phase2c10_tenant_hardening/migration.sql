-- Phase2C10Backfill: assign orphan tenant rows (seed runs and
-- pre-stamping fixtures left NULL companyIds) to Company #1 before the
-- NOT NULL tightening below. Deterministic and idempotent
-- (`IS NULL` guards): dedicated-company fixtures always stamp
-- explicitly, so unstamped rows are Company #1-logical. No rows are
-- created, deleted, or otherwise modified.
UPDATE `categories` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;
UPDATE `products` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;
UPDATE `product_variants` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;
UPDATE `coupons` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;
UPDATE `marketing_notifications` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;
UPDATE `site_announcements` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;

-- DropForeignKey
ALTER TABLE `categories` DROP FOREIGN KEY `categories_company_id_fkey`;

-- DropForeignKey
ALTER TABLE `coupons` DROP FOREIGN KEY `coupons_company_id_fkey`;

-- DropForeignKey
ALTER TABLE `marketing_notifications` DROP FOREIGN KEY `marketing_notifications_company_id_fkey`;

-- DropForeignKey
ALTER TABLE `product_variants` DROP FOREIGN KEY `product_variants_company_id_fkey`;

-- DropForeignKey
ALTER TABLE `products` DROP FOREIGN KEY `products_company_id_fkey`;

-- DropForeignKey
ALTER TABLE `site_announcements` DROP FOREIGN KEY `site_announcements_company_id_fkey`;

-- DropIndex
DROP INDEX `categories_slug_key` ON `categories`;

-- DropIndex
DROP INDEX `product_variants_sku_key` ON `product_variants`;

-- DropIndex
DROP INDEX `products_slug_key` ON `products`;

-- AlterTable
ALTER TABLE `categories` MODIFY `company_id` CHAR(36) NOT NULL;

-- AlterTable
ALTER TABLE `coupons` MODIFY `company_id` CHAR(36) NOT NULL;

-- AlterTable
ALTER TABLE `marketing_notifications` MODIFY `company_id` CHAR(36) NOT NULL;

-- AlterTable
ALTER TABLE `product_variants` MODIFY `company_id` CHAR(36) NOT NULL;

-- AlterTable
ALTER TABLE `products` MODIFY `company_id` CHAR(36) NOT NULL;

-- AlterTable
ALTER TABLE `site_announcements` MODIFY `company_id` CHAR(36) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `categories_company_id_slug_key` ON `categories`(`company_id`, `slug`);

-- CreateIndex
CREATE UNIQUE INDEX `product_variants_company_id_sku_key` ON `product_variants`(`company_id`, `sku`);

-- CreateIndex
CREATE UNIQUE INDEX `products_company_id_slug_key` ON `products`(`company_id`, `slug`);

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupons` ADD CONSTRAINT `coupons_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `marketing_notifications` ADD CONSTRAINT `marketing_notifications_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_announcements` ADD CONSTRAINT `site_announcements_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
