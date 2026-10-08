-- AlterTable
ALTER TABLE `coupons` ADD COLUMN `company_id` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `coupons_company_id_idx` ON `coupons`(`company_id`);

-- Phase2C6Backfill: all pre-existing coupons belong to Company #1
-- (the only company that existed when they were created). Additive:
-- no row is modified except to receive its tenant association. Codes,
-- values, limits, and usage counters are untouched.
UPDATE `coupons` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;

-- AddForeignKey
ALTER TABLE `coupons` ADD CONSTRAINT `coupons_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
