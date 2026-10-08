-- AlterTable
ALTER TABLE `categories` ADD COLUMN `company_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `product_variants` ADD COLUMN `company_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `products` ADD COLUMN `company_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `company_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `companies` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `admin_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `companies_admin_user_id_key`(`admin_user_id`),
    INDEX `companies_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_domains` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `domain` VARCHAR(255) NOT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `company_domains_domain_key`(`domain`),
    INDEX `company_domains_company_id_idx`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `categories_company_id_idx` ON `categories`(`company_id`);

-- CreateIndex
CREATE INDEX `product_variants_company_id_idx` ON `product_variants`(`company_id`);

-- CreateIndex
CREATE INDEX `products_company_id_idx` ON `products`(`company_id`);

-- CreateIndex
CREATE INDEX `users_company_id_idx` ON `users`(`company_id`);

-- Phase1Backfill: Company #1 owns all pre-existing Tech Pulse data.
-- Additive and deterministic: no existing row is modified except to
-- receive its tenant association. Ids, emails, slugs, SKUs, barcodes,
-- and order numbers are untouched. All predicates are `IS NULL` guards
-- so the statements are safe on populated databases.
INSERT INTO `companies` (`id`, `name`, `status`, `admin_user_id`, `created_at`, `updated_at`)
VALUES ('35b5a215-0cf3-42db-ba42-6fac6656a708', 'Tech Pulse', 'ACTIVE', NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

UPDATE `users` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;
UPDATE `categories` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;
UPDATE `products` SET `company_id` = '35b5a215-0cf3-42db-ba42-6fac6656a708' WHERE `company_id` IS NULL;

-- Variants inherit tenancy from their parent product (productId is
-- immutable by application behavior, so this cannot drift).
UPDATE `product_variants` AS `v`
INNER JOIN `products` AS `p` ON `p`.`id` = `v`.`product_id`
SET `v`.`company_id` = `p`.`company_id`
WHERE `v`.`company_id` IS NULL;

-- Associate the earliest ADMIN account (the pre-SaaS Tech Pulse
-- administrator) as Company #1's ADMIN. Stays NULL when no ADMIN
-- exists yet (documented bootstrap window); never fabricates a user.
UPDATE `companies`
SET `admin_user_id` = (
  SELECT `u`.`id`
  FROM `users` AS `u`
  INNER JOIN `user_roles` AS `ur` ON `ur`.`user_id` = `u`.`id`
  INNER JOIN `roles` AS `r` ON `r`.`id` = `ur`.`role_id` AND `r`.`name` = 'ADMIN'
  ORDER BY `u`.`created_at` ASC
  LIMIT 1
)
WHERE `id` = '35b5a215-0cf3-42db-ba42-6fac6656a708';

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companies` ADD CONSTRAINT `companies_admin_user_id_fkey` FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_domains` ADD CONSTRAINT `company_domains_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
