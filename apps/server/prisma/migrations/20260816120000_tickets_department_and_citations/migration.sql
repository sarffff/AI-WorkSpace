-- P1：工单域 + 部门权限 + 引用溯源

-- AlterTable（user：部门 + 角色；默认用户提权为 admin 便于演示全貌）
ALTER TABLE `user` ADD COLUMN `department` VARCHAR(191) NULL;
ALTER TABLE `user` ADD COLUMN `role` VARCHAR(191) NOT NULL DEFAULT 'employee';
UPDATE `user` SET `role` = 'admin' WHERE `id` = '000000';

-- AlterTable（document：部门共享标记 + 索引）
ALTER TABLE `document` ADD COLUMN `department` VARCHAR(191) NULL;
CREATE INDEX `Document_department_idx` ON `document`(`department`);

-- AlterTable（message：RAG 引用溯源）
ALTER TABLE `message` ADD COLUMN `sources` JSON NULL;

-- CreateTable（工单域）
CREATE TABLE IF NOT EXISTS `ticket` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `priority` VARCHAR(191) NOT NULL DEFAULT 'normal',
    `creatorId` VARCHAR(191) NOT NULL,
    `assigneeId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Ticket_creatorId_idx`(`creatorId`),
    INDEX `Ticket_assigneeId_idx`(`assigneeId`),
    INDEX `Ticket_status_idx`(`status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `Ticket_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `Ticket_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
