-- Memory 与 token 追踪
-- 1) Chat 增加会话摘要字段（token 级历史裁剪的配套）
ALTER TABLE `Chat`
  ADD COLUMN `summary` TEXT NULL,
  ADD COLUMN `summaryAnchorId` VARCHAR(191) NULL;

-- 2) Message 增加 token 用量列（每次对话可聚合）
ALTER TABLE `Message`
  ADD COLUMN `promptTokens` INT NULL,
  ADD COLUMN `completionTokens` INT NULL;

-- 3) 跨会话长期记忆表
CREATE TABLE `Memory` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NOT NULL,
  `content` VARCHAR(255) NOT NULL,
  `chatId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Memory_userId_category_content_key` (`userId`, `category`, `content`),
  KEY `Memory_userId_category_idx` (`userId`, `category`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Memory`
  ADD CONSTRAINT `Memory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
