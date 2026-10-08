-- AlterTable
ALTER TABLE `companies` ADD COLUMN `address_line1` VARCHAR(255) NULL,
    ADD COLUMN `address_line2` VARCHAR(255) NULL,
    ADD COLUMN `city` VARCHAR(100) NULL,
    ADD COLUMN `contact_email` VARCHAR(255) NULL,
    ADD COLUMN `contact_phone` VARCHAR(30) NULL,
    ADD COLUMN `country` VARCHAR(100) NULL,
    ADD COLUMN `logo_path` VARCHAR(500) NULL,
    ADD COLUMN `postal_code` VARCHAR(20) NULL,
    ADD COLUMN `state` VARCHAR(100) NULL,
    ADD COLUMN `website` VARCHAR(500) NULL;
