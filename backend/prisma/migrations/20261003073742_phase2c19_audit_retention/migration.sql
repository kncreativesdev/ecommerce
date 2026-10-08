-- CreateTable
CREATE TABLE `audit_retention_policy` (
    `id` VARCHAR(32) NOT NULL DEFAULT 'global',
    `policy` VARCHAR(20) NOT NULL DEFAULT 'NEVER',
    `updated_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
