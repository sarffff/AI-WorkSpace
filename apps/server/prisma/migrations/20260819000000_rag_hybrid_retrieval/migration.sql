-- RAG 混合检索改造：双级切块（父块供 LLM / 叶子块参与检索）+ 章节路径 + 上下文前缀
-- 旧版单级块兼容：embedding 保留，parentId 为空 → 命中后返回自身

-- AlterTable（叶子→父块引用 + 章节路径 + embedding 可空）
ALTER TABLE `knowledgechunk` ADD COLUMN `parentId` VARCHAR(191) NULL;
ALTER TABLE `knowledgechunk` ADD COLUMN `sectionPath` TEXT NULL;
ALTER TABLE `knowledgechunk` MODIFY `embedding` JSON NULL;

-- AddIndex
CREATE INDEX `KnowledgeChunk_parentId_idx` ON `knowledgechunk`(`parentId`);