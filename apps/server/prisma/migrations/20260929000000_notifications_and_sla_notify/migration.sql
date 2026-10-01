-- 站内通知：工单事件与 SLA 预警触达对应用户（前端轮询未读数）。
-- userId 不建外键（与 Memory.chatId 一致）：删用户不该让通知表产生级联写，
-- 孤儿通知按 userId 查询不可见，自然失效。
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(500) NOT NULL,
    `payload` JSON NULL,
    `read` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_read_createdAt_idx`(`userId`, `read`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- SLA 通知阶段：null 未通知 | at_risk 已发濒临违约预警 | breached 已发违约通知。
-- 定时扫描器据此保证每阶段只推一次；可空以兼容存量工单（视作未通知，扫到即补推）。
ALTER TABLE `Ticket` ADD COLUMN `slaNotifyStage` VARCHAR(191) NULL;
