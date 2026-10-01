-- 知识缺口台账：清单可以从工单重算，落库只为了记住人对它的处置（成文 / 不打算补 / 出处）。
-- ticketId 唯一 —— 同步时按它跳过已有行，坐席的决定不能被一次重算冲掉。
-- 不建外键：工单可被删，删单不该抹掉"这条缺口我们补过文档"的痕迹（与 Ticket.chatId 同理）。
--
-- 索引取舍：读路径只有两种形状 ——「按 status 取待补清单」与「按 status+category 汇总看板」，
-- 所以只建 (status, category)；firstSeenAt 单独建索引是给"这条挂了多久"的排序用的，
-- 数据量与缺口数同阶（每张已解决的 AI 工单最多一条），不是热写表。
CREATE TABLE `KnowledgeGap` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NULL,
    `category` VARCHAR(191) NOT NULL,
    `question` VARCHAR(500) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `hasSolution` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `closedBy` VARCHAR(191) NULL,
    `closedDocId` VARCHAR(191) NULL,
    `closeNote` VARCHAR(500) NULL,
    `closedAt` DATETIME(3) NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KnowledgeGap_ticketId_key`(`ticketId`),
    INDEX `KnowledgeGap_status_category_idx`(`status`, `category`),
    INDEX `KnowledgeGap_firstSeenAt_idx`(`firstSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
