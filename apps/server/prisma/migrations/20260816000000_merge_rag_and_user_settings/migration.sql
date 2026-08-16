-- 本次合并的最小迁移：远程分支的 RAG 表结构 + Settings 按用户隔离
-- 注意：库中存在不属于本仓库 schema 的表（prompt/supportticket/task 等），
-- 它们由其他实验产生，本迁移刻意不做任何删除，保持原样。

-- AlterTable（去掉历史占位默认值，密码必须真实提供；幂等）
ALTER TABLE `user` MODIFY `password` VARCHAR(191) NOT NULL;

-- CreateTable（RAG 向量块；部分环境已由 db push 提前创建，幂等处理）
CREATE TABLE IF NOT EXISTS `knowledgechunk` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `index` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `embedding` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KnowledgeChunk_documentId_idx`(`documentId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `KnowledgeChunk_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable（Setting 从全局 key-value 改为按用户隔离；表当前为空，无需回填）
ALTER TABLE `setting` DROP PRIMARY KEY,
    ADD COLUMN `userId` VARCHAR(191) NOT NULL,
    ADD PRIMARY KEY (`userId`, `key`);

-- AddForeignKey
ALTER TABLE `setting` ADD CONSTRAINT `Setting_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
