-- AgentRun 运行轨迹表：Agent 每次流式回答的可观测落库记录
-- （决策轮/工具调用/生成明细 steps + 分轮 token 记账；chatId/userId 不建外键）
CREATE TABLE `AgentRun` (
    `id` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'completed',
    `rounds` INTEGER NOT NULL DEFAULT 0,
    `toolCalls` INTEGER NOT NULL DEFAULT 0,
    `sources` INTEGER NOT NULL DEFAULT 0,
    `ticketId` VARCHAR(191) NULL,
    `ticketTitle` VARCHAR(191) NULL,
    `promptTokens` INTEGER NOT NULL DEFAULT 0,
    `completionTokens` INTEGER NOT NULL DEFAULT 0,
    `replyChars` INTEGER NOT NULL DEFAULT 0,
    `totalMs` INTEGER NOT NULL DEFAULT 0,
    `steps` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AgentRun_chatId_createdAt_idx`(`chatId`, `createdAt`),
    INDEX `AgentRun_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
