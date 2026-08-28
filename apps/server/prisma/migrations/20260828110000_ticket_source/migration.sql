-- 工单来源：manual 手动创建 | agent AI 对话升级（坐席看板偏转率统计依据）
ALTER TABLE `Ticket` ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'manual';
