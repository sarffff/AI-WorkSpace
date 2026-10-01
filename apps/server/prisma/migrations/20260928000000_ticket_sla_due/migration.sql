-- 工单 SLA 到期时刻：建单时按优先级阈值从创建时间折算，未完结工单在优先级变更时重算。
-- 目的是把 SLA 从"事后统计达标率"推进到"违约之前预警"——看板要能在到期前拦下高优先级工单。
--
-- 索引取舍：违约扫描只看未完结存量（status IN (open, processing)），这个集合有界，
-- 已有的复合索引 (status, updatedAt) 的 status 左前缀已把它大幅收窄，剩下按 dueAt 排是
-- 小集合内的 filesort，不值再加一条 (status, dueAt) 索引（每次写入多一次维护）。
-- 与仓内既有立场一致：只为真正的全表范围扫描加索引，不为有界的看板查询加。
ALTER TABLE `Ticket` ADD COLUMN `dueAt` DATETIME(3) NULL;

-- 历史回填：存量工单按当时优先级折算 dueAt，让功能对既有数据即刻可用，
-- 而不是让所有老单都落进"未排期"。已完结的单一并回填无妨——违约扫描只看未完结的。
UPDATE `Ticket`
SET `dueAt` = DATE_ADD(
  `createdAt`,
  INTERVAL (CASE `priority`
    WHEN 'urgent' THEN 4
    WHEN 'high' THEN 8
    WHEN 'low' THEN 48
    ELSE 24
  END) HOUR
)
WHERE `dueAt` IS NULL;
