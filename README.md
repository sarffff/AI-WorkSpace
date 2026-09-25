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
- [x] **索引中断恢复**：上传字节只在内存队列暂存、从不落盘，重启后既取不回任务也续跑不了；
      启动时把超过宽限期（`RAG_INDEX_STALE_GRACE_MIN`，默认 10 分钟）仍未完成的
      `processing` 文档收敛为 `failed` 并点名告警，前端不再无限轮询「处理中」。
      宽限期同时兜住多实例部署，避免误杀另一实例正在索引的文档
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
