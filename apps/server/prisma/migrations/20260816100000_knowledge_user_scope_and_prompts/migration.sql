-- 知识库按用户隔离 + 提示词模块

-- AlterTable（document 增加归属用户；NOT NULL DEFAULT 使存量文档自动归属默认用户 000000）
ALTER TABLE `document` ADD COLUMN `userId` VARCHAR(191) NOT NULL DEFAULT '000000';

-- AddForeignKey + 索引
ALTER TABLE `document` ADD CONSTRAINT `Document_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX `Document_userId_idx` ON `document`(`userId`);

-- CreateTable（提示词）
CREATE TABLE IF NOT EXISTS `prompt` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT '通用',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Prompt_userId_idx`(`userId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `Prompt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
