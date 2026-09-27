-- 工单归属会话：AI 升级的工单来自哪次对话。
-- 之所以放进 Ticket 而不是查 AgentRun：AgentRun 是观测副作用（AGENT_TRACE=off 就不落），
-- 而偏转率的分子是业务事实，不能寄生在一个可关的开关上。
-- 不建外键：会话可被用户删除，删会话不该抹掉工单归属（历史统计要能追溯）。

ALTER TABLE `Ticket` ADD COLUMN `chatId` VARCHAR(191) NULL;

CREATE INDEX `Ticket_chatId_idx` ON `Ticket`(`chatId`);

-- 历史回填：AgentRun 同时记了 chatId 与 ticketId，能追回一部分老工单。
-- AgentRun.ticketId 没索引，这是一次性全表 join —— 迁移期可接受，运行期不跑。
UPDATE `Ticket` t
JOIN `AgentRun` r ON r.`ticketId` = t.`id`
SET t.`chatId` = r.`chatId`
WHERE t.`chatId` IS NULL AND r.`ticketId` IS NOT NULL;
