-- Agent 人设提示词版本化：把 AGENT_PERSONA 从代码常量变成可发布、可回溯的数据。
-- 只有先给提示词编上版本，「这批 👎 是哪一版提示词产生的」才是可回答的问题；
-- 此前负例已经能连同工具轨迹导出（eval:collect），但归因不到改动本身。
CREATE TABLE `AgentPersona` (
    `id` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `note` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'archived',
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AgentPersona_version_key`(`version`),
    INDEX `AgentPersona_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- personaVersion：本次运行用的提示词版本，与 messageId 一起构成
-- 「被评价的回答 → 当次提示词版本 + 工具轨迹」的完整归因链。
-- requestId：一次提问跨多次 LLM 调用与异步确认，靠它把 HTTP 日志与运行轨迹串起来。
-- 存量记录为 NULL（不参与按版本聚合），无需回填。
ALTER TABLE `AgentRun` ADD COLUMN `personaVersion` INTEGER NULL;
ALTER TABLE `AgentRun` ADD COLUMN `requestId` VARCHAR(191) NULL;
CREATE INDEX `AgentRun_personaVersion_idx` ON `AgentRun`(`personaVersion`);
CREATE INDEX `AgentRun_requestId_idx` ON `AgentRun`(`requestId`);
