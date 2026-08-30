-- Memory 增加内容向量列：按当前问题语义相关性召回长期记忆（为空回退按 updatedAt 排序）
ALTER TABLE `Memory`
  ADD COLUMN `embedding` JSON NULL;
