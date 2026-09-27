# 工单分类体系 + 满意度反馈闭环

一次 schema 迁移落地两项能力基础：工单分类（解锁路由/趋势/知识沉淀）与答案反馈
（把评测从手写用例升级为真实分布）。

已确认决策：**6 类扁平分类** · **👍/👎 + 👎 原因标签** · **一并打通评测导出**

---

## 一、Schema 迁移（单个迁移文件）

`prisma/migrations/20260913000000_ticket_category_and_message_feedback/migration.sql`

| 表            | 新增列                                                  | 说明                                    |
| :------------ | :------------------------------------------------------ | :-------------------------------------- |
| `Ticket`      | `category VARCHAR(191) NOT NULL DEFAULT 'other'` + 索引 | 6 类扁平分类                            |
| `TicketDraft` | `category VARCHAR(191) NOT NULL DEFAULT 'other'`        | **必须**：HITL 草稿要携带分类           |
| `Message`     | `feedback VARCHAR(191) NULL`                            | `up` \| `down`                          |
| `Message`     | `feedbackReason VARCHAR(191) NULL`                      | 仅 👎 时可选                            |
| `Message`     | `feedbackAt DATETIME(3) NULL`                           | 反馈时间（导出按期筛选用）              |
| `AgentRun`    | `messageId VARCHAR(191) NULL` + 索引                    | **关键**：打通「被评价的回答 → 其轨迹」 |

分类取值：`account` 账号权限 / `hardware` 硬件设备 / `network` 网络访问 /
`software` 软件应用 / `process` 制度流程 / `other` 其他

👎 原因取值：`wrong` 答案错误 / `unsolved` 没解决问题 /
`bad_citation` 引用来源不准 / `irrelevant` 答非所问

**两个必要性说明**（否则功能不完整）：

1. `TicketDraft.category` —— HITL 确认后工单是**按持久化草稿重建**的
   （`createFromDraft`）。草稿不存分类，则所有走确认门的 Agent 工单分类全部丢失。
2. `AgentRun.messageId` —— 当前 `AgentRun` 只有 `chatId`，从被点👎的 Message
   **无法**定位到它的工具轨迹。不补这一列，导出的负例就只有问题文本、没有
   「当时调了什么工具、检索命中了什么」，评测价值大幅下降。
   `saveAiMessage` 已返回 message（当前返回值被丢弃），`persistAgentRun` 在其后调用，
   id 天然可得；`savePartialMessage` 改为返回 id 同理。

---

## 二、后端

### 分类

- `tickets.dto.ts`：`CreateTicketDto.category`（`@IsIn` 6 值，可选默认 other）；
  `UpdateTicketDto.category`（坐席可纠正分类）
- `tickets.service.ts`：`CATEGORY_LABEL` 映射；`update()` 支持改分类并写系统事件留痕
  （与现有 status/priority 变更留痕一致）；`stats()` 增加 `byCategory` 聚合
- `agent-tools/create-ticket.tool.ts`：schema 加 `category`
  （`enum` + `fallback: 'other'` —— 模型选错自动回退，不报错打断建单）；
  `createFromDraft` 透传分类
- `chat.service.ts`：HITL 确认路径的 `ticketDraft.upsert` 与重建建单带上分类；
  `listPendingTicketDrafts` 返回分类
- `TicketDraft` 类型（`agent-tools/types.ts`）补 `category`

### 反馈

- `chat.service.ts` 新增 `setMessageFeedback(userId, chatId, messageId, feedback, reason?)`：
  校验会话归属 + 消息属于该会话 + 只允许对 `assistant` 消息评价 + 枚举校验；
  `feedback: null` 表示取消评价（再次点击同一按钮）
- `chat.controller.ts`：`POST /chats/:id/messages/:messageId/feedback`
- `startStream`：捕获 `saveAiMessage` 返回的 id → 传入 `persistAgentRun`；
  `savePartialMessage` 返回 id 后同样传入（partial 路径）
- `generateAiResponse`（非流式路径）不落 AgentRun，无需改动

### 统计与导出

- `analytics.service.ts`：`overview` 增加 `feedback` 段
  （up/down 计数、满意度率、👎 原因分布）。基于 `Message` 聚合（期内 assistant 消息）
- 新增 `src/scripts/eval-collect.ts` + `package.json` 的 `eval:collect`：
  导出近 N 天 👎 消息，join `AgentRun.messageId` 取出该次运行的工具调用与命中文档，
  按现有数据集字段格式（query/expectSearch/expectTicket/expectTicketLookup/expectedDocs）
  生成**候选**用例写入 `scripts/eval-agent-candidates.json`，`note` 写入反馈原因与实际行为。
  明确定位为「人工复核后并入 `eval-agent-dataset.json`」——
  不自动并入，避免把模型的错误行为当成期望行为固化进基线。
  沿用现有 eval 脚本约定（nest build 后 node 执行，不走 tsx）。

---

## 三、前端

- `packages/types`：`TicketItem.category`、`TicketCategoryStats`、
  `TICKET_CATEGORIES` 常量、`ServerMessage`/`Message` 的反馈字段、
  `MessageFeedbackReason`、`AgentRunOverview.feedback`
- `packages/sdk`：`setMessageFeedback()`；`createTicket` 入参加 `category`
- `TicketDetailModal.tsx`：`CATEGORY_META`（与既有 `STATUS_META`/`PRIORITY_META` 同处导出，
  保持单一来源）；详情展示分类徽标
- `TicketsPage.tsx`：建单表单分类选择器（与优先级选择器同风格）；列表分类徽标；
  统计面板分类分布条形图；坐席可改分类
- `ChatPage.tsx`：AI 消息下方 👍/👎；点👎展开原因标签（可跳过直接提交）；
  已评价状态高亮并支持取消/改选；`TicketConfirmCard` 展示待建工单的分类
- `AnalyticsPage.tsx`：满意度面板（满意度率 + 👎 原因分布）

---

## 四、测试（目标 127 → 约 160）

- `agent-tools/tools.spec.ts`：分类 enum 合法值、幻觉值回退 `other`、缺省回退；
  `createFromDraft` 透传分类
- `agent-tools/schema.spec.ts`：已覆盖 enum+fallback 组合，按需补充
- 新增 `chat/message-feedback.spec.ts`：反馈校验纯逻辑
  （非法枚举、对 user 消息评价应拒绝、取消评价、reason 仅在 down 时保留）
  —— 抽成纯函数以便脱离 Prisma 测试
- `analytics.service.spec.ts`：feedback 聚合（含无反馈时为 null 的边界）
- `tickets.service.spec.ts`：`byCategory` 聚合
- 新增 `scripts/eval-collect` 的候选生成纯函数单测（轨迹 → 候选用例的映射）

---

## 五、执行顺序

1. 迁移 SQL + schema.prisma + `prisma generate`
2. 后端分类链路（dto → service → tool → HITL 草稿）
3. 后端反馈链路（messageId 贯通 → setFeedback → 接口）
4. 统计聚合 + eval:collect 脚本
5. 共享类型 + sdk
6. 前端三处界面
7. 补测试 → lint / build / test 全绿 → 分两个 commit（分类、反馈）

## 六、风险与边界

- **迁移不可逆**：新增列均带默认值，存量数据自动归入 `other` / 反馈为空，不需要数据回填
- **分类语义漂移**：模型可能把「VPN 连不上」判为 `network` 或 `software`。
  接受这一模糊性（fallback + 坐席可纠正），不引入二级分类
- **反馈刷票**：同一消息重复提交按最后一次覆盖（非累加），天然幂等
- **导出脚本需真实 DB**：与既有 `eval:retrieval`/`eval:agent` 一致，不纳入 CI
