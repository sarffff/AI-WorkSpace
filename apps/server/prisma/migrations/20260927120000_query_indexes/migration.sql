-- 索引审查：按实际查询形状补齐，并去掉被复合索引左前缀覆盖的冗余单列索引。
-- 全部先建后删，不预留无索引窗口。

-- Message：历史加载（按会话取 + 按时间排）与每日 token 预算的 SUM
-- （chatId IN (该用户会话) AND createdAt >= 今日 0 点）。
-- 只有单列 chatId 索引时会把整个会话的消息全捞出来再筛时间窗，会话越长越贵，
-- 而这条查询每个提问都要跑一次。
CREATE INDEX `Message_chatId_createdAt_idx` ON `Message`(`chatId`, `createdAt`);

-- Ticket：坐席列表 ORDER BY status asc, updatedAt desc 与积压分组 status IN (open, processing)。
-- 左前缀即 status，故单列索引冗余，建完即删。
CREATE INDEX `Ticket_status_updatedAt_idx` ON `Ticket`(`status`, `updatedAt`);

DROP INDEX `Ticket_status_idx` ON `Ticket`;

-- Ticket：SLA 统计按 createdAt >= since 取区间，此前无索引即全表扫。
CREATE INDEX `Ticket_createdAt_idx` ON `Ticket`(`createdAt`);
