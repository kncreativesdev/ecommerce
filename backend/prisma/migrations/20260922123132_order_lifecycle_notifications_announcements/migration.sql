-- AlterTable
ALTER TABLE `orders` MODIFY `status` ENUM('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DISPATCHED', 'IN_TRANSIT', 'ARRIVED_IN_CITY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE `order_status_history` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DISPATCHED', 'IN_TRANSIT', 'ARRIVED_IN_CITY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED') NOT NULL,
    `previous_status` ENUM('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DISPATCHED', 'IN_TRANSIT', 'ARRIVED_IN_CITY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED') NULL,
    `note` VARCHAR(500) NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_status_history_order_id_idx`(`order_id`),
    INDEX `order_status_history_order_id_created_at_idx`(`order_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` ENUM('ORDER_STATUS', 'MARKETING') NOT NULL DEFAULT 'ORDER_STATUS',
    `title` VARCHAR(150) NOT NULL,
    `message` TEXT NOT NULL,
    `order_id` CHAR(36) NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `read_at` DATETIME(3) NULL,

    INDEX `notifications_user_id_idx`(`user_id`),
    INDEX `notifications_user_id_is_read_idx`(`user_id`, `is_read`),
    INDEX `notifications_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `marketing_notifications` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `message` TEXT NOT NULL,
    `type` ENUM('DEAL', 'OFFER', 'ANNOUNCEMENT') NOT NULL DEFAULT 'OFFER',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `starts_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `link_type` VARCHAR(20) NULL,
    `link_value` VARCHAR(100) NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `marketing_notifications_is_active_idx`(`is_active`),
    INDEX `marketing_notifications_starts_at_idx`(`starts_at`),
    INDEX `marketing_notifications_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_announcements` (
    `id` CHAR(36) NOT NULL,
    `message` VARCHAR(200) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `starts_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `link_label` VARCHAR(50) NULL,
    `link_target` VARCHAR(200) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `site_announcements_is_active_idx`(`is_active`),
    INDEX `site_announcements_starts_at_idx`(`starts_at`),
    INDEX `site_announcements_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `order_status_history` ADD CONSTRAINT `order_status_history_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
