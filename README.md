# ServiceDeck · 智能服务台

> 企业级 AI Helpdesk Agent：知识库问答（RAG + 引用溯源 + 部门权限）→ 自动回答；超出范围升级工单 → 坐席人工闭环。Monorepo 架构。

---

## 📖 项目介绍

**ServiceDeck** 是面向企业 IT 服务台的智能 Agent 系统：员工提问优先由 AI 基于部门知识库检索回答（附引用溯源），无法自动解决的问题升级为工单，由坐席受理闭环。项目采用 **pnpm Workspace + Turborepo** 进行高效的 Monorepo 工程化管理，前端基于 **React 19 + Electron + Vite + Tailwind CSS (FSD 架构)**，后端基于 **NestJS + Prisma + MySQL**。

---

## 🛠️ 技术栈

| 模块                  | 技术选型                                             | 说明                         |
| :-------------------- | :--------------------------------------------------- | :--------------------------- |
| **Monorepo**          | pnpm Workspace + Turborepo                           | 高效包管理与增量构建缓存     |
| **桌面端 (Client)**   | Electron + React 19 + TypeScript + Vite              | 跨平台桌面客户端，FSD 架构   |
| **UI & 样式**         | Tailwind CSS + Lucide React                          | 现代美观的 UI 设计与图标库   |
| **状态管理**          | Redux Toolkit + TanStack Query                       | 客户端状态与服务端状态管理   |
| **后端服务 (Server)** | NestJS                                               | 企业级 Node.js 后端架构      |
| **ORM & 数据库**      | Prisma ORM + MySQL                                   | 类型安全数据库交互与关系建模 |
| **实时通信**          | SSE                                                  | 实时流式 AI 对话与事件推送   |
| **AI 能力**           | OpenAI SDK (可扩展多 Provider)                       | LLM 模型接入与 Prompt 工程   |
| **工程化**            | ESLint + Prettier + Husky + lint-staged + Commitlint | 代码规范与提交校验           |

---

## 📂 目录结构

```text
AI-Workspace/
├── apps/
│   ├── desktop/              # Electron + React 桌面端 (遵循 FSD 架构)
│   │   ├── electron/         # Electron 主进程与预加载脚本
│   │   └── src/              # FSD 分层源码 (app, pages, widgets, entities, shared)
│   └── server/               # NestJS 后端服务
│       ├── prisma/           # Prisma Schema & 数据库迁移 (MySQL)
│       └── src/              # 后端源码 (modules/auth, modules/chat, modules/knowledge, modules/settings, prisma)
├── packages/                 # 共享包
│   ├── ui/                   # 共享 UI 组件库
│   ├── sdk/                  # AI/API SDK 封装
│   ├── shared/               # 公共工具函数
│   ├── types/                # 公共 TypeScript 类型定义
│   └── config/               # 公共配置 (ESLint, TSConfig 等)
├── package.json              # 根项目工作空间配置
├── pnpm-workspace.yaml       # pnpm 工作空间声明
└── turbo.json                # Turborepo 构建任务编排
```

---

## 🗺️ Roadmap & 开发计划

### Phase 1: 基础设施与架构搭建 (已完成 ✅)

- [x] 初始化 pnpm Workspace 与 Turborepo Monorepo 结构
- [x] 配置根目录工程化工具 (ESLint, Prettier, Husky, Commitlint)
- [x] 搭建 `apps/desktop` (Electron + React 19 + Vite + Tailwind, FSD 架构)
- [x] 搭建 `apps/server` (NestJS + Prisma + MySQL)
- [x] 统一安装及校验所有技术栈依赖

### Phase 2: 核心功能开发 (已完成 ✅)

- [x] **AI 聊天模块**：SSE 流式对话，Agent 工具循环（`search_knowledge` / `create_ticket`），反思轮与工具轨迹展示
- [x] **RAG 知识库**：文档上传、清洗、父子块切片、向量化存储；稠密向量 + BM25 混合检索、RRF 融合、Reranker 精排与降级；异步索引队列与进度追踪；行级权限（用户/部门）与引用溯源
- [x] **Prompt 提示词广场**：预设模板与自定义提示词管理
- [x] **系统设置**：API Key 配置与链接测试，RAG 与用户设置动态合并
- [x] **工单闭环 (超出原计划)**：Agent 超范围自动升级工单，坐席/管理员受理，角色权限隔离
- [x] **会话记忆 (超出原计划)**：会话与工单上下文沉淀，支撑个性化召回
- [x] **检索质量评测 (超出原计划)**：Top-K 命中率 / MRR 回归评测脚本与数据集

### Phase 3: 高级特性与多 Provider 扩展 (进行中 🚧)

- [x] **Agent 工具注册表化**：工具改为「一个类 = 一个工具」（`modules/chat/agent-tools/`），
      schema 单一真相同时驱动运行时校验与给模型的 JSON Schema；新增工具只需实现 `AgentTool`
      并登记，无需再改工具循环
- [x] **Agent 可观测看板**：运行轨迹落库（`AgentRun`）+ 分轮 token 记账 + 坐席端统计看板
- [x] **单元测试与 CI 流水线**：GitHub Actions（lint / build / test），
      覆盖工具校验与边界处理、上下文预算、检索切片清洗、工单 SLA 统计等纯逻辑
- [x] 坐席工作台深化：工单分派、SLA 与状态流转看板
- [x] **多 Provider 接入**：DeepSeek / Ollama 等 OpenAI 兼容服务在设置页配置
      `llmBaseUrl` + `llmModel` 即可接入（含模型降级链）。Anthropic 原生协议不在支持范围
      （tool use 为 content block 结构，与现有 OpenAI 兼容链路差异较大，收益不足）
- [x] **答案满意度反馈与评测数据飞轮**：assistant 消息支持 👍/👎 及负例原因
      （`wrong` / `unsolved` / `bad_citation` / `irrelevant`），`AgentRun.messageId` 打通
      「被评价的回答 → 当次工具轨迹」，`eval:collect` 将负例连同实际检索/建单行为导出为
      评测候选用例；看板展示满意度与原因分布
- [x] **工单分类体系**：`account` / `hardware` / `network` / `software` / `process` / `other`
      以 `ticket-taxonomy.ts` 为服务端单一真相，同时驱动 DTO 校验、`create_ticket` 工具给
      模型的 enum 与看板分类分布，为后续自动派单提供路由依据
- [x] **检索开销收敛**：语料索引按可见范围缓存（语料变更代数失效，TTL 兜底跨进程），
      BM25 改倒排表，叶子向量在构建期 L2 归一化、检索时以点积替代余弦。
      5000 块 × 1024 维基准下单次检索 136ms → 7ms（纯 CPU，未计省去的全量行读取），
      top-20 排序与改造前一致。**稠密检索仍是线性扫描**，万级以上需引入真正的向量索引
- [x] **索引任务跨重启续跑**：上传原始字节先落盘（`UPLOAD_STORE_DIR`，默认 `data/uploads`）
      再入队。启动时对超期的 `processing` 文档分三档处理——取回副本的**重新入队接着跑完**、
      确实没有副本的置 `failed`（需重传）、读取出错的本轮不动（留待下次重试）。
      索引进终态或文档被删除时同步清掉副本。
      刻意用本地磁盘而不是 Redis/对象存储：吞吐撑不起新增依赖，且与仓内既有立场一致
- [x] **降级回退显式化**：SSE 中断时客户端回退到非流式 `POST /chats/:id/completions` ——
      该路径仍做 RAG 并落库，但不跑工具循环（不会自动升级工单）。此前它静默返回一段
      无出处、看起来与正常回答无异的答案；现在端点回传引用来源，答案上明确标注
      「降级回答 · 不会自动升级工单」，并纳入 E2E 覆盖
- [x] **Agent 可靠性收口**：只读工具执行超时熔断（`TOOL_TIMEOUT_MS`，超时回传结构化错误
      驱动反思轮；写工具刻意不设超时）；同一会话只允许一条在途流（409），与每用户并发
      上限（429）分属两种语义
- [x] **提示词版本化与归因链**：Agent 人设从代码常量迁入 `AgentPersona` 表（`active` 恰一条，
      发布走事务、限管理员），`AgentRun` 记录 `personaVersion` 与 `requestId`，
      `eval:collect` 导出的 👎 负例带上版本号 —— 补齐「负例收集 → 改提示词 → 回归验证」
      缺的最后一段。管理入口 `GET|POST /agent-persona`
- [x] **引用溯源去重**：同一父块被多轮检索命中不再重复计数，`[n]` 脚注与实际片段对齐
- [x] **决策模型分档**：多轮工具决策每轮都重发整个上下文（人设 + 记忆 + 历史 + 回填的
      tool 结果），是 token 大头，而它只做「选哪个工具、填什么参数」。新增
      `LLM_DECISION_MODEL` / Setting `llmDecisionModel` 可单独指定，缺省仍与生成同模型
      —— 选错工具的代价直接落在用户头上，不该为省钱默认降级
- [x] **检索排序离线回归进 CI**：排序主体抽成不依赖 Nest 与数据库的纯函数
      （`coarseRank` / `rankCandidates` / `fallbackRank`），线上与评测共用同一实现；
      固定语料 + 录制向量后，HitRate@K / MRR / 词法召回 / 正负例区分度在无 Key 无 DB
      下随 `test:ci` 跑。它同时暴露了 `ragMinScore` 默认值挡不住无关查询的缺陷（见文末）
- [x] **HITL 确认门有界等待**：只等内存 resolver 时，跨实例的确认会让本侧生成器永久挂起
      （冻住 SSE、会话槽位与界面）。改为本实例 resolver / 草稿状态轮询 / 超时三路竞速；
      超时不等于拒绝——草稿保持 pending，用户之后重新进入会话仍可确认建单
- [x] **断连取消贯穿到请求层**：客户端断连除了回收生成器，还把 `AbortSignal` 传到
      `LlmClient`：当场掐掉 in-flight 请求，并且**不再重试、不再降级到备用模型**
      （此前用户点了停止，这一次提问仍会把「重试 × N + 备用模型 × M」整条链跑完，token 照付）。
      循环侧在每个决策轮、工具执行前、生成前都复查信号；确认门把它作为第四路竞速接入
      （那一刻没有中间 yield，queued 的 return() 指望不上，否则会话槽位要被占到超时窗口跑完）。
      一个反直觉的点：SDK 在 abort 时把流关成「正常结束」而不是抛错，所以生成结束后还要再查一次，
      不然截断的回答会被当完整回答落库
- [ ] Electron 打包发布：`electron-updater` 已在主进程接线（仅打包态检查更新），
      后端 API 地址支持 localStorage > `VITE_API_BASE_URL` > 默认值三级解析；
      仍缺更新源 (feed URL) 与签名产物，即「能打包」但「未可发布」
- [x] **桌面端主链路冒烟 (E2E)**：Playwright 驱动 Electron，后端由同源 HTTP 替身托管
      （`apps/desktop/e2e/mock-backend.ts`，SSE 帧序按真实服务端写法手工构造）。
      覆盖 登录 → 提问 → 流式回答（工具轨迹 / 引用溯源）→ HITL 建单确认 → 工单落进工单页，
      并含拒绝建单分支。`pnpm --filter @servicedesk/desktop test:e2e`
      暂未进 CI：需要下载 Electron 二进制并在 Linux 上备显示服务

---

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动开发模式 (Turbo)

```bash
pnpm dev
```

---

## 🔐 首次启动与管理员

后端**不再**自动创建 `default@example.com / 123456` 的管理员账号 —— 那等于给企业系统
常驻一个公开口令的管理员，而且每次重启都会把改过的密码重置回去。

现在只在「用户表为空」时按环境变量引导一次：

```bash
BOOTSTRAP_ADMIN_PASSWORD='至少 8 位的强口令' pnpm --filter @servicedesk/server dev
```

| 变量                       | 说明                                                 |
| :------------------------- | :--------------------------------------------------- |
| `BOOTSTRAP_ADMIN_PASSWORD` | 必填才会创建；短于 8 位直接拒绝（不静默降级）        |
| `BOOTSTRAP_ADMIN_EMAIL`    | 缺省 `default@example.com`（与评测脚本默认视角一致） |
| `BOOTSTRAP_ADMIN_NAME`     | 显示名，缺省「系统管理员」                           |

已有用户的库一律不改动。空库且未给口令时只写一条警告 —— 此时通过界面注册的第一个
账号只是普通员工（`User.role` 默认 `employee`），进不了坐席与管理视图。

`GET /health` 为无需鉴权的就绪探针（含 MySQL `SELECT 1` 探活，不可用返 503），供进程管理器与反向代理使用。

## 🧠 Agent 提示词版本

Agent 人设（系统提示词）存在 `AgentPersona` 表里，恰有一条 `status=active`；
首次启动自动播种 v1（内容取自内置副本 `agent-persona.ts`，读不到库时也会回退该副本，
此时 `AgentRun.personaVersion` 记 0 以示区分）。

```bash
# 查看版本历史（含正文，供 diff）
curl -H "Authorization: Bearer $TOKEN" localhost:4000/agent-persona

# 发布新版本并置为生效（仅管理员；正文过短会被拒绝）
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"...完整人设全文...","note":"修 👎 负例：过度澄清"}' \
  localhost:4000/agent-persona
```

版本化的目的不是"能在线改提示词"，而是**回答可归因**：每条 `AgentRun` 记下当时生效的
版本号，`eval:collect` 导出的 👎 负例也带着它。于是"改了提示词到底有没有修好这批负例"
是个可回答的问题 —— 在此之前负例只能看到工具轨迹，看不到当时的行为规则是哪一版。

## 🚦 限流与并发配额

一次 Agent 对话会打出 1-4 次决策调用 + 1 次流式生成，并在服务端挂住一条 SSE
（HITL 确认门更可以挂很久），因此两层约束：

| 变量                              | 默认   | 作用                                                                                |
| :-------------------------------- | :----- | :---------------------------------------------------------------------------------- |
| `THROTTLE_TTL_MS`                 | 60000  | 全局限流窗口                                                                        |
| `THROTTLE_LIMIT`                  | 600    | 窗口内每用户请求数（客户端有轮询，不宜过紧）                                        |
| `STREAM_RATE_LIMIT_PER_MIN`       | 20     | 对话流端点单独收紧                                                                  |
| `MAX_CONCURRENT_STREAMS_PER_USER` | 2      | 每用户**在途**流上限，超出返回 HTTP 429                                             |
| `TOOL_TIMEOUT_MS`                 | 30000  | 只读工具等待上限，超时回传结构化错误驱动改道（写工具不设超时）                      |
| `CONFIRM_WAIT_TIMEOUT_MS`         | 300000 | HITL 确认门最长等待。超时只是本轮收尾：草稿保持 pending，之后重新进入会话可继续确认 |

限流按**用户**（JWT 的单向哈希）分桶而非 IP —— 办公室里所有人共用一个出口 IP，
按 IP 限流会让同事之间互相拖累。计数是单进程内存态，多实例部署需换 Redis。

`CORS_ORIGIN` 缺省放行所有来源，是桌面形态决定的：打包后渲染层以 `file://` 运行
（Origin 为 `null`），收紧白名单会直接打断客户端。接入网页端时用逗号分隔白名单配置它。

`NODE_ENV=production` 时若 `JWT_SECRET` 缺失或仍为开发兜底值 `dev-secret`，
进程**拒绝启动**（该值可被用来自签任意用户含 admin 的 token）。

## 🧪 评测与本地命令

```bash
pnpm --filter @servicedesk/server eval:retrieval   # 检索命中率 / MRR（需真实 MySQL + 模型 Key）
pnpm --filter @servicedesk/server eval:agent       # Agent 工具决策回归（无副作用入口）
pnpm --filter @servicedesk/server eval:collect     # 把 👎 反馈连同当次工具轨迹导出为候选评测用例
pnpm --filter @servicedesk/server eval:record-corpus  # 重录离线评测语料与查询向量
pnpm --filter @servicedesk/desktop test:e2e        # Electron 主链路冒烟（同源 mock 后端，无需 Key）
```

评测默认以 `default@example.com` 视角跑（管理员可见全部语料）；用
`EVAL_USER_EMAIL=...` 切到某部门员工视角验证行级权限。

### 离线排序回归（已在 CI 内）

`eval:retrieval` / `eval:agent` 需要真实 MySQL 与模型 Key，CI 无密钥跑不了。
`eval:record-corpus` 把一份固定语料的叶子向量与查询向量录成
`scripts/eval-corpus-fixture.json`，之后 `src/scripts/retrieval-offline.spec.ts`
在无数据库、无网络下重跑**与线上同一组**排序函数（`coarseRank` →
`rankCandidates` → `fallbackRank`），校验 HitRate@K、MRR、词法召回与正负例区分度。
它随 `pnpm test:ci` 一起跑，所以改动混合检索/融合排序不再没有门禁。

换 embedding 模型后该用例会失败并要求重录 —— 向量不再同一空间时评测结果无意义，
这是设计而非 bug。

⚠️ **已知缺陷（离线回归暴露，尚未调参）**：负例的最高稠密分 0.415 已越过线上默认
阈值 `ragMinScore = 0.25`，即语义门对完全无关的问题拦不住；生产上看到的"负例不误召回"
其实是 reranker 的终筛（`> 0.01`）在兜。一旦 rerank 未配置或调用失败回退，
就会把无关文档当知识库依据引用出来。实测正负例分数区间是 0.620–0.824 vs 0.360–0.415，
把阈值定在 0.45–0.6 之间可在不伤这批正例的前提下挡住负例 —— 但阈值该用真实语料定，
不在合成语料上改默认值。
