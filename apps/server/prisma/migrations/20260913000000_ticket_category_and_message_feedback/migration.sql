-- 工单分类：account 账号权限 | hardware 硬件设备 | network 网络访问
--          | software 软件应用 | process 制度流程 | other 其他
-- 存量工单归入 other（默认值），无需数据回填；索引供分类分布统计与后续自动派单路由使用
ALTER TABLE `Ticket` ADD COLUMN `category` VARCHAR(191) NOT NULL DEFAULT 'other';
CREATE INDEX `Ticket_category_idx` ON `Ticket`(`category`);

-- HITL 建单草稿同样要携带分类：确认后的工单是按草稿重建的（createFromDraft），
-- 草稿不存分类则所有走确认门的 Agent 工单会丢失分类
ALTER TABLE `TicketDraft` ADD COLUMN `category` VARCHAR(191) NOT NULL DEFAULT 'other';

-- 答案满意度反馈：feedback = up | down（NULL 为未评价）；
-- feedbackReason 仅 down 时可选（wrong 答案错误 | unsolved 没解决问题
-- | bad_citation 引用来源不准 | irrelevant 答非所问）
ALTER TABLE `Message` ADD COLUMN `feedback` VARCHAR(191) NULL;
ALTER TABLE `Message` ADD COLUMN `feedbackReason` VARCHAR(191) NULL;
ALTER TABLE `Message` ADD COLUMN `feedbackAt` DATETIME(3) NULL;
CREATE INDEX `Message_feedback_feedbackAt_idx` ON `Message`(`feedback`, `feedbackAt`);

-- AgentRun 关联到它产出的那条回答：打通「被评价的回答 → 当次工具轨迹」的 join 路径。
-- 此前 AgentRun 只有 chatId，无法从某条被点👎的消息定位到它的检索/建单轨迹，
-- 导致反馈无法携带「当时调了什么工具、命中了什么文档」进入评测。
-- 存量记录为 NULL（不参与导出），不需要回填。
ALTER TABLE `AgentRun` ADD COLUMN `messageId` VARCHAR(191) NULL;
CREATE INDEX `AgentRun_messageId_idx` ON `AgentRun`(`messageId`);
