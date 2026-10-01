-- 对话附件：用户在会话里提交的截图/日志/配置等证据，字节落盘、此表存元数据。
-- chatId/uploaderId 不建外键（与 TicketDraft 一致）：删会话不产生级联写，字节由 deleteChat 显式清理。
CREATE TABLE `ChatAttachment` (
    `id` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NOT NULL,
    `uploaderId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChatAttachment_chatId_idx`(`chatId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 用户消息的附件元数据（展示芯片用）；正文注入只进 LLM 上下文，不落消息正文
ALTER TABLE `Message` ADD COLUMN `attachments` JSON NULL;
