-- CreateTable
CREATE TABLE `coupon_histories` (
    `id` CHAR(36) NOT NULL,
    `coupon_id` CHAR(36) NOT NULL,
    `actor_id` CHAR(36) NULL,
    `actor_email` VARCHAR(255) NULL,
    `action` ENUM('CREATED', 'UPDATED', 'DEACTIVATED', 'REACTIVATED', 'DELETED') NOT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `coupon_histories_coupon_id_created_at_idx`(`coupon_id`, `created_at`),
    INDEX `coupon_histories_actor_id_idx`(`actor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
