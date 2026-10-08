-- AlterTable
ALTER TABLE `marketing_notifications` ADD COLUMN `company_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `site_announcements` ADD COLUMN `company_id` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `marketing_notifications_company_id_idx` ON `marketing_notifications`(`company_id`);

-- CreateIndex
CREATE INDEX `site_announcements_company_id_idx` ON `site_announcements`(`company_id`);

-- Phase2C7Backfill: pre-existing broadcasts belong to Company #1 (the
-- only company that existed when they were authored). Additive: no row
-- is modified except to receive its tenant association.
UPDATE `marketing_notifications` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;
UPDATE `site_announcements` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;

-- AddForeignKey
ALTER TABLE `marketing_notifications` ADD CONSTRAINT `marketing_notifications_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_announcements` ADD CONSTRAINT `site_announcements_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
