-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `actor_id` CHAR(36) NULL,
    `actor_role` VARCHAR(50) NOT NULL,
    `actor_email` VARCHAR(255) NULL,
    `company_id` CHAR(36) NULL,
    `action` VARCHAR(50) NOT NULL,
    `resource` VARCHAR(100) NOT NULL,
    `resource_id` CHAR(36) NULL,
    `outcome` VARCHAR(20) NOT NULL,
    `details` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_company_id_created_at_idx`(`company_id`, `created_at`),
    INDEX `audit_logs_actor_id_created_at_idx`(`actor_id`, `created_at`),
    INDEX `audit_logs_resource_resource_id_created_at_idx`(`resource`, `resource_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
